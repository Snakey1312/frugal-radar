'use strict';

const cheerio = require('cheerio');
const { parseRoPrice } = require('./matching');

const NEGATIVE_PRICE_CONTEXT_RE = /(?:transport|livrare|rate|lunar|economis|voucher|peste|minim|easybox|curier)/i;
const RO_PRICE_REGEX = /(\d{1,3}(?:[.\s]\d{3})+|\d+)(?:[,.](\d{1,2}))?\s*(?:lei|ron)\b/gi;

const SHOE_SIZE_RE = /^(?:3[5-9]|4[0-8])(?:[.,]5)?$/;
const CLOTHES_SIZE_RE = /^(?:XXS|XS|S|M|L|XL|XXL|XXXL|2XL|3XL)$/i;
const OOS_CLASS_OR_TEXT_RE = /\b(?:oos|out-of-stock|out_of_stock|disabled|epuizat|unavailable|sold-out|sold_out|indisponibil|not-available|strikethrough)\b/i;

const STORE_TITLE_SUFFIX_RE = /\s*[-|–|•]\s*(eMAG\.ro|Altex\.ro|Altex|Media Galaxy|Fashion Days|Answear(?:\.ro)?|epantofi(?:\.ro)?|MODIVO|ABOUT YOU|Zalando(?:\.ro)?|GymBeam(?:\.ro)?|PC Garage|Flanco|Vexio|evoMAG|ForIT|CEL\.ro|Flip\.ro|Dr\.?Max|Farmacia Tei|Bebe Tei|Springfarma|Notino(?:\.ro)?|Sephora(?:\.ro)?|Decathlon|Dedeman|Hornbach|IKEA|Cărturești|elefant\.ro).*$/i;

function cleanText(str) {
  return String(str || '').replace(/\s+/g, ' ').trim();
}

function extractSlugFromUrl(parsedUrl) {
  if (!parsedUrl) return '';
  try {
    const segments = parsedUrl.pathname
      .split('/')
      .filter((s) => s && !['pd', 'p', 'cpd', 'produs', 'product', 'ro', 'cautare', 'search'].includes(s.toLowerCase()));
    const longest = [...segments].sort((a, b) => b.length - a.length)[0] || parsedUrl.hostname;
    return longest
      .replace(/\.html?$/i, '')
      .replace(/-[a-z0-9]{6,}$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  } catch {
    return '';
  }
}

function isRonCurrency(currency) {
  if (!currency) return true;
  const norm = String(currency).trim().toUpperCase();
  return norm === 'RON' || norm === 'LEI';
}

function isAvailabilityInStock(avail) {
  if (!avail) return null;
  const s = String(avail).toLowerCase();
  if (s.includes('outofstock') || s.includes('out_of_stock') || s.includes('soldout') || s.includes('discontinued')) {
    return false;
  }
  if (s.includes('instock') || s.includes('in_stock') || s.includes('preorder') || s.includes('limitedavailability')) {
    return true;
  }
  return null;
}

function collectJsonLdNodes(json, out = []) {
  if (!json || typeof json !== 'object') return out;
  if (Array.isArray(json)) {
    for (const item of json) collectJsonLdNodes(item, out);
    return out;
  }
  if (Array.isArray(json['@graph'])) {
    collectJsonLdNodes(json['@graph'], out);
  }
  out.push(json);
  return out;
}

function parseJsonLdProducts($) {
  const products = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const nodes = collectJsonLdNodes(parsed);
      for (const node of nodes) {
        const types = Array.isArray(node['@type']) ? node['@type'] : [node['@type']];
        if (types.some((t) => t === 'Product' || t === 'ProductGroup')) {
          products.push(node);
        }
      }
    } catch {
      // Ignore malformed JSON-LD blocks
    }
  });
  return products;
}

function extractOfferPrice(offer) {
  if (!offer || typeof offer !== 'object') return null;
  if (offer.priceCurrency && !isRonCurrency(offer.priceCurrency)) return null;
  const candidates = [offer.price, offer.lowPrice, offer.highPrice];
  for (const cand of candidates) {
    if (cand == null) continue;
    const num = typeof cand === 'number' ? cand : parseRoPrice(String(cand));
    if (num && num > 0) return num;
  }
  if (Array.isArray(offer.offers)) {
    for (const nested of offer.offers) {
      const p = extractOfferPrice(nested);
      if (p) return p;
    }
  }
  return null;
}

function collectOffersFromProduct(product) {
  const list = [];
  if (Array.isArray(product.offers)) {
    list.push(...product.offers);
  } else if (product.offers && typeof product.offers === 'object') {
    list.push(product.offers);
    if (Array.isArray(product.offers.offers)) {
      list.push(...product.offers.offers);
    }
  }
  if (Array.isArray(product.hasVariant)) {
    for (const variant of product.hasVariant) {
      if (variant && typeof variant === 'object') {
        if (Array.isArray(variant.offers)) {
          for (const vo of variant.offers) list.push({ ...vo, _variantSize: variant.size || vo.size });
        } else if (variant.offers && typeof variant.offers === 'object') {
          list.push({ ...variant.offers, _variantSize: variant.size || variant.offers.size });
        }
      }
    }
  }
  return list;
}

function detectMarketplaceHints($, parsedUrl) {
  const host = parsedUrl ? parsedUrl.hostname.toLowerCase() : '';
  const bodyText = cleanText($('body').text()).slice(0, 15000);

  let sellerType = 'unknown';
  let sellerName = null;
  let isGeniusEligible = null;

  const isEmag = host.includes('emag.ro');
  const isAltex = host.includes('altex.ro') || host.includes('mediagalaxy.ro');
  const isFashionDays = host.includes('fashiondays.ro');
  const isTrendyol = host.includes('trendyol.com');

  if (isEmag) {
    if ($('.emag-genius-badge, [data-test="genius-badge"], .badge-genius, [class*="genius"]').length > 0 ||
        /\bgenius\b/i.test($('.product-highlight, .product-page-pricing, .main-product-form').text())) {
      isGeniusEligible = true;
    }
    const sellerText = cleanText($('.seller-name, .product-seller-name, [data-test="seller-name"]').first().text())
      || bodyText.match(/V[aâ]ndut\s+(?:și|si)\s+livrat\s+de:\s*([^|\n,]{2,50})/i)?.[1]
      || bodyText.match(/V[aâ]ndut\s+de:\s*([^|\n,]{2,50})/i)?.[1];
    if (sellerText) {
      sellerName = cleanText(sellerText);
      sellerType = /\bemag\b/i.test(sellerName) ? '1p' : '3p';
    } else if (/v[aâ]ndut\s+(?:și|si)\s+livrat\s+de\s+emag/i.test(bodyText)) {
      sellerType = '1p';
      sellerName = 'eMAG';
    }
  } else if (isAltex) {
    const sellerMatch = bodyText.match(/V[aâ]ndut\s+(?:și\s+livrat\s+)?de\s*:?\s*([A-Za-z0-9 .&-]{2,45})/i);
    if (sellerMatch) {
      sellerName = cleanText(sellerMatch[1]);
      sellerType = /\baltex|media\s*galaxy\b/i.test(sellerName) ? '1p' : '3p';
    }
  } else if (isFashionDays) {
    if ($('[class*="genius"]').length > 0) isGeniusEligible = true;
    const sellerMatch = bodyText.match(/V[aâ]ndut\s+de\s*:?\s*([A-Za-z0-9 .&-]{2,45})/i);
    if (sellerMatch) {
      sellerName = cleanText(sellerMatch[1]);
      sellerType = /\bfashion\s*days\b/i.test(sellerName) ? '1p' : '3p';
    }
  } else if (isTrendyol) {
    sellerType = '3p';
    const sellerEl = cleanText($('.merchant-name, [data-testid="merchant-name"]').first().text());
    if (sellerEl) sellerName = sellerEl;
  }

  return { sellerType, sellerName, isGeniusEligible };
}

/**
 * Extract structured product metadata (JSON-LD, OG/meta, 1P/3P hints, URL fallback).
 */
function extractMetadataFromHtml(html, parsedUrl) {
  const result = {
    title: '',
    image: '',
    price: null,
    currency: 'RON',
    brand: '',
    gtin: '',
    mpn: '',
    sellerType: 'unknown',
    sellerName: null,
    isGeniusEligible: null,
    marketplace: { sellerType: 'unknown', sellerName: null, isGeniusEligible: null },
    scrapedLive: true,
  };

  if (!html || typeof html !== 'string') {
    result.title = extractSlugFromUrl(parsedUrl);
    result.scrapedLive = false;
    return result;
  }

  const $ = cheerio.load(html);
  const products = parseJsonLdProducts($);

  for (const item of products) {
    if (item.name && !result.title) {
      result.title = cleanText(item.name);
    }
    if (item.brand && !result.brand) {
      result.brand = cleanText(typeof item.brand === 'string' ? item.brand : (item.brand.name || ''));
    }
    if (!result.gtin) {
      const gtinVal = item.gtin13 || item.gtin14 || item.gtin12 || item.gtin8 || item.gtin;
      if (gtinVal) result.gtin = cleanText(gtinVal);
    }
    if (!result.mpn) {
      const mpnVal = item.mpn || item.sku;
      if (mpnVal) result.mpn = cleanText(mpnVal);
    }
    if (item.image && !result.image) {
      const firstImg = Array.isArray(item.image) ? item.image[0] : item.image;
      result.image = cleanText(typeof firstImg === 'string' ? firstImg : (firstImg?.url || ''));
    }
    if (result.price == null) {
      const offers = collectOffersFromProduct(item);
      for (const offer of offers) {
        const p = extractOfferPrice(offer);
        if (p) {
          result.price = p;
          break;
        }
      }
    }
  }

  if (!result.title) {
    const ogTitle = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content');
    if (ogTitle) result.title = cleanText(ogTitle);
  }
  if (!result.title) {
    const h1 = $('h1').first().text();
    if (h1 && cleanText(h1).length >= 4) {
      result.title = cleanText(h1);
    }
  }
  if (!result.title) {
    const titleTag = $('title').first().text();
    if (titleTag) {
      result.title = cleanText(titleTag).replace(STORE_TITLE_SUFFIX_RE, '').trim();
    }
  }
  if (!result.image) {
    const ogImg = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content');
    if (ogImg) result.image = cleanText(ogImg);
  }
  if (result.price == null) {
    result.price = extractMetaPrice($);
  }

  const mp = detectMarketplaceHints($, parsedUrl);
  result.marketplace = mp;
  result.sellerType = mp.sellerType;
  result.sellerName = mp.sellerName;
  result.isGeniusEligible = mp.isGeniusEligible;

  if (!result.title) {
    result.title = extractSlugFromUrl(parsedUrl);
    result.scrapedLive = false;
  }

  return result;
}

function extractMetaPrice($) {
  const metaCurrency =
    $('meta[property="product:price:currency"]').attr('content') ||
    $('meta[property="og:price:currency"]').attr('content') ||
    $('meta[itemprop="priceCurrency"]').attr('content') ||
    $('[itemprop="priceCurrency"]').attr('content') ||
    '';

  if (metaCurrency && !isRonCurrency(metaCurrency)) return null;

  const metaSelectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[itemprop="price"]',
  ];
  for (const sel of metaSelectors) {
    const val = $(sel).attr('content');
    if (val) {
      const p = parseRoPrice(val);
      if (p && p > 0) return p;
    }
  }

  const itempropEl = $('[itemprop="price"]').first();
  if (itempropEl.length > 0) {
    const raw = itempropEl.attr('content') || itempropEl.text();
    const p = parseRoPrice(raw);
    if (p && p > 0) return p;
  }
  return null;
}

/**
 * Extract product price from HTML:
 * JSON-LD -> meta/itemprop -> storeConfig priceSelector -> RO price regex rejecting +-40-char negative context.
 */
function extractPriceFromHtml(html, parsedUrl, storeConfig) {
  if (!html || typeof html !== 'string') return null;

  const $ = cheerio.load(html);

  // 1. JSON-LD
  const products = parseJsonLdProducts($);
  for (const item of products) {
    const offers = collectOffersFromProduct(item);
    for (const offer of offers) {
      const p = extractOfferPrice(offer);
      if (p) return p;
    }
  }

  // 2. Meta / itemprop
  const metaPrice = extractMetaPrice($);
  if (metaPrice) return metaPrice;

  // 3. Store-specific priceSelector
  const customSel = storeConfig?.scraperConfig?.priceSelector;
  if (customSel) {
    const priceEls = $(customSel);
    for (let i = 0; i < priceEls.length; i++) {
      const el = $(priceEls[i]);
      const raw = el.attr('content') || el.attr('data-price') || el.text();
      const p = parseRoPrice(raw);
      if (p && p > 0) return p;
    }
  }

  // 4. Fallback RO price regex rejecting +-40-char negative context (bounded per block/line)
  const $clean = cheerio.load(html);
  $clean('script, style, noscript, svg, template').remove();
  $clean('p, div, li, tr, section, article, span, h1, h2, h3, h4, td').each((_, el) => {
    $clean(el).prepend('\n').append('\n');
  });
  const lines = $clean('body').text().split(/\n+/);

  for (const rawLine of lines) {
    const line = cleanText(rawLine);
    if (!line) continue;
    RO_PRICE_REGEX.lastIndex = 0;
    let match;
    while ((match = RO_PRICE_REGEX.exec(line)) !== null) {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(line.length, match.index + match[0].length + 40);
      const context = line.slice(start, end);
      if (NEGATIVE_PRICE_CONTEXT_RE.test(context)) {
        continue;
      }
      const p = parseRoPrice(match[0]);
      if (p && p > 1) return p;
    }
  }

  return null;
}

function normalizeSizeToken(raw, category) {
  if (raw == null) return null;
  let s = cleanText(String(raw)).toUpperCase();
  if (!s) return null;
  // Strip prefixes like "EU 42", "MARIMEA 42", "MĂRIMEA M"
  s = s.replace(/^(?:EU|RO|MARIMEA|MĂRIMEA|SIZE)\s*[:.-]?\s*/i, '').trim();
  // Strip trailing stock notices like "42 - in stoc"
  s = s.split(/\s*[-–|(/]\s*/)[0].trim();

  if (category === 'shoes') {
    const normalized = s.replace(',', '.');
    if (SHOE_SIZE_RE.test(normalized)) return normalized;
    return null;
  }
  if (category === 'clothes') {
    if (CLOTHES_SIZE_RE.test(s)) return s;
    return null;
  }
  return null;
}

function extractSizesFromJsonLd($, category) {
  const products = parseJsonLdProducts($);
  const available = new Set();
  const outOfStock = new Set();
  let sawProductAvailability = null;

  for (const prod of products) {
    const offers = collectOffersFromProduct(prod);
    for (const offer of offers) {
      const avail = isAvailabilityInStock(offer.availability);
      if (avail === true && sawProductAvailability !== true) sawProductAvailability = true;
      if (avail === false && sawProductAvailability == null) sawProductAvailability = false;

      const rawSize = offer._variantSize || offer.size || prod.size;
      const sz = normalizeSizeToken(rawSize, category);
      if (sz) {
        if (avail === false) outOfStock.add(sz);
        else available.add(sz);
      }
    }
  }

  return {
    available: [...available],
    outOfStock: [...outOfStock],
    sawProductAvailability,
    foundSizes: available.size + outOfStock.size >= 1,
  };
}

function findMagentoSpConfig(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 8) return null;
  if (obj.spConfig && typeof obj.spConfig === 'object' && obj.spConfig.attributes) {
    return obj.spConfig;
  }
  if (obj.jsonConfig && typeof obj.jsonConfig === 'object' && obj.jsonConfig.attributes) {
    return obj.jsonConfig;
  }
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      const found = findMagentoSpConfig(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function extractSizesFromMagentoInit($, category) {
  const available = new Set();
  const outOfStock = new Set();

  $('script[type="text/x-magento-init"]').each((_, el) => {
    const raw = $(el).contents().text().trim();
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      const spConfig = findMagentoSpConfig(parsed);
      if (!spConfig || !spConfig.attributes) return;

      const salableMap = spConfig.salable || spConfig.stock || null;

      for (const attr of Object.values(spConfig.attributes)) {
        if (!attr || !Array.isArray(attr.options)) continue;
        const codeOrLabel = `${attr.code || ''} ${attr.label || ''}`.toLowerCase();
        const isSizeAttr = /size|marim|mărim|shoe|clothing/.test(codeOrLabel) ||
          attr.options.filter((o) => normalizeSizeToken(o?.label, category)).length >= 2;
        if (!isSizeAttr) continue;

        for (const opt of attr.options) {
          const sz = normalizeSizeToken(opt?.label, category);
          if (!sz) continue;
          const products = Array.isArray(opt.products) ? opt.products : [];
          let inStock = products.length > 0;
          if (opt.in_stock === false || opt.is_salable === false || opt.disabled === true) {
            inStock = false;
          } else if (salableMap && products.length > 0) {
            inStock = products.some((pid) => {
              const entry = salableMap[pid];
              if (entry === false || entry === 0) return false;
              if (entry && typeof entry === 'object') {
                return entry.is_in_stock !== false && entry.salable !== false && entry.qty !== 0;
              }
              return true;
            });
          }
          if (inStock) available.add(sz);
          else outOfStock.add(sz);
        }
      }
    } catch {
      // Ignore invalid Magento init JSON
    }
  });

  return {
    available: [...available],
    outOfStock: [...outOfStock],
    foundSizes: available.size + outOfStock.size >= 1,
  };
}

function walkHydrationForSizes(node, category, available, outOfStock, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 10) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      walkHydrationForSizes(item, category, available, outOfStock, depth + 1);
    }
    return;
  }

  // Detect objects representing a size/variant item: { size: "42", available: true } or { label: "M", inStock: false }
  const rawSize = node.size ?? node.sizeLabel ?? node.sizeName ?? (node.attributeCode === 'size' ? node.label : null);
  const sz = typeof rawSize === 'string' || typeof rawSize === 'number'
    ? normalizeSizeToken(rawSize, category)
    : null;

  if (sz) {
    const explicitFlags = [
      node.inStock,
      node.isInStock,
      node.available,
      node.isAvailable,
      node.salable,
      node.isSalable,
    ].filter((v) => typeof v === 'boolean');

    const stockQty = typeof node.stock === 'number'
      ? node.stock
      : (typeof node.quantity === 'number' ? node.quantity : (typeof node.qty === 'number' ? node.qty : null));

    const oosFlag = node.outOfStock === true || node.isOutOfStock === true || node.disabled === true || node.soldOut === true;

    if (oosFlag || explicitFlags.includes(false) || stockQty === 0) {
      outOfStock.add(sz);
    } else if (explicitFlags.includes(true) || (stockQty !== null && stockQty > 0)) {
      available.add(sz);
    }
  }

  for (const [k, v] of Object.entries(node)) {
    if (k === 'recommendations' || k === 'relatedProducts' || k === 'similarProducts') continue;
    if (v && typeof v === 'object') {
      walkHydrationForSizes(v, category, available, outOfStock, depth + 1);
    }
  }
}

function extractAssignedJsonObject(html, varNames) {
  const results = [];
  for (const name of varNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(?:window\\.|var\\s+|let\\s+|const\\s+)?${escaped}\\s*=\\s*(\\{)`, 'g');
    let m;
    while ((m = re.exec(html)) !== null) {
      const startIdx = m.index + m[0].length - 1;
      let depth = 0;
      let inStr = false;
      let quote = '';
      let escapedChar = false;
      let endIdx = -1;

      for (let i = startIdx; i < Math.min(html.length, startIdx + 350000); i++) {
        const ch = html[i];
        if (inStr) {
          if (escapedChar) {
            escapedChar = false;
          } else if (ch === '\\') {
            escapedChar = true;
          } else if (ch === quote) {
            inStr = false;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStr = true;
          quote = ch;
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      if (endIdx > startIdx) {
        try {
          results.push(JSON.parse(html.slice(startIdx, endIdx)));
        } catch {
          // Ignore non-JSON assignment
        }
      }
    }
  }
  return results;
}

function extractSizesFromHydration($, html, category) {
  const available = new Set();
  const outOfStock = new Set();

  const nextDataRaw = $('script#__NEXT_DATA__').contents().text().trim();
  if (nextDataRaw) {
    try {
      const nextJson = JSON.parse(nextDataRaw);
      walkHydrationForSizes(nextJson, category, available, outOfStock);
    } catch { /* ignore */ }
  }

  if (available.size + outOfStock.size === 0) {
    const assigned = extractAssignedJsonObject(html, ['__APOLLO_STATE__', '__INITIAL_STATE__', '__NEXT_DATA__']);
    for (const obj of assigned) {
      walkHydrationForSizes(obj, category, available, outOfStock);
    }
  }

  for (const sz of outOfStock) available.delete(sz);

  return {
    available: [...available],
    outOfStock: [...outOfStock],
    foundSizes: available.size + outOfStock.size >= 2,
  };
}

function extractSizesFromDom($, category, storeConfig) {
  const selectors = [
    storeConfig?.scraperConfig?.sizeContainerSelector,
    '[data-testid*="size"]',
    '[data-test*="size"]',
    '.size-selector',
    '.sizes-list',
    '.product-sizes',
    '.swatch-attribute.size',
    'select[name*="size" i]',
    'select[name*="marime" i]',
    '[class*="size-select"]',
    '[class*="marimi"]',
  ].filter(Boolean);

  const available = new Set();
  const outOfStock = new Set();

  for (const sel of selectors) {
    const containers = $(sel);
    if (containers.length === 0) continue;

    containers.each((_, container) => {
      const $c = $(container);
      const itemSelector = $c.is('select')
        ? 'option'
        : 'button, a, li, option, [role="option"], [role="radio"], label, .size-option, .swatch-option';

      let items = $c.find(itemSelector);
      if (items.length === 0 && $c.is('button, a, li, option, [role="option"], [role="radio"]')) {
        items = $c;
      }

      items.each((__, itemEl) => {
        const $el = $(itemEl);
        const rawCandidate =
          $el.attr('data-size') ||
          $el.attr('data-option-label') ||
          $el.attr('value') ||
          $el.text();

        const sz = normalizeSizeToken(rawCandidate, category);
        if (!sz) return;

        const cls = $el.attr('class') || '';
        const parentCls = $el.parent().attr('class') || '';
        const isDisabled =
          $el.is(':disabled') ||
          $el.attr('disabled') !== undefined ||
          $el.attr('aria-disabled') === 'true' ||
          $el.attr('data-available') === 'false' ||
          $el.attr('data-in-stock') === 'false' ||
          $el.attr('data-stock') === '0' ||
          OOS_CLASS_OR_TEXT_RE.test(cls) ||
          OOS_CLASS_OR_TEXT_RE.test(parentCls) ||
          OOS_CLASS_OR_TEXT_RE.test($el.text());

        if (isDisabled) {
          outOfStock.add(sz);
        } else {
          available.add(sz);
        }
      });
    });

    if (available.size + outOfStock.size >= 2) break;
  }

  for (const sz of outOfStock) available.delete(sz);

  return {
    available: [...available],
    outOfStock: [...outOfStock],
    foundSizes: available.size + outOfStock.size >= 2,
  };
}

function sortSizes(sizes, category) {
  if (category === 'shoes') {
    return [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b));
  }
  const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', '3XL', 'XXXL'];
  return [...sizes].sort((a, b) => order.indexOf(a) - order.indexOf(b));
}

/**
 * Truthful 3-state stock & size extraction:
 * NEVER returns hasDesiredSize: true on failure/unknown!
 */
// eMAG family/color pages keep every size in an embedded JS object:
// EM.product = { ..., characteristics: [{ name: "Marime", products: [...] }] }
// The inner array is strict JSON, so we can slice it with a balanced scan.
function extractSizesFromEmagCharacteristics(html, category) {
  const available = new Set();
  const outOfStock = new Set();
  const sizePrices = new Map();
  const keyRe = /"characteristics"\s*:\s*\[/g;
  let found = false;
  let match;

  while ((match = keyRe.exec(html)) !== null) {
    const arrayStart = match.index + match[0].length - 1;
    let i = arrayStart + 1;
    let depth = 1;
    let end = -1;
    let inStr = false;
    let esc = false;
    for (; i < html.length; i++) {
      const ch = html[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end <= arrayStart) {
      keyRe.lastIndex = arrayStart + 1;
      continue;
    }
    keyRe.lastIndex = end;

    let groups;
    try {
      groups = JSON.parse(html.slice(arrayStart, end));
    } catch {
      continue;
    }
    if (!Array.isArray(groups)) continue;

    for (const group of groups) {
      if (!/marim|mărim|size/i.test(String(group?.name || ''))) continue;
      const products = Array.isArray(group.products) ? group.products : [];
      if (products.length === 0) continue;
      found = true;

      for (const product of products) {
        const sz = normalizeSizeToken(product?.label ?? product?.original_size ?? product?.sef_name, category);
        if (!sz) continue;
        const canOrder = product.is_available !== false && product.may_be_ordered !== false;
        if (canOrder) {
          available.add(sz);
          const price = Number(product?.price?.current);
          if (Number.isFinite(price) && price > 0) sizePrices.set(sz, price);
        } else {
          outOfStock.add(sz);
        }
      }
    }
  }

  return {
    available: [...available],
    outOfStock: [...outOfStock],
    sizePrices: Object.fromEntries(sizePrices),
    foundSizes: found && available.size + outOfStock.size >= 1,
    sawProductAvailability: found ? true : null,
  };
}

function extractStockAndSizesFromHtml(html, url, category, desiredSize, storeConfig) {
  const requiresSize = category === 'shoes' || category === 'clothes';
  const target = requiresSize ? normalizeSizeToken(desiredSize, category) || cleanText(desiredSize).toUpperCase() : '';

  if (!html || typeof html !== 'string') {
    return {
      requiresSize,
      verificationState: 'unverified_unknown',
      status: 'unknown',
      label: requiresSize && target ? `Verifică mărimea ${target} pe site` : 'Stoc neverificat',
      availableSizes: [],
      hasDesiredSize: null,
      isVerified: false,
    };
  }

  const $ = cheerio.load(html);
  const jsonLdRes = extractSizesFromJsonLd($, category);

  if (!requiresSize) {
    if (jsonLdRes.sawProductAvailability === false) {
      return {
        requiresSize: false,
        verificationState: 'verified_out_of_stock',
        status: 'out_of_stock',
        label: 'Stoc epuizat',
        availableSizes: [],
        hasDesiredSize: false,
        isVerified: true,
      };
    }
    if (jsonLdRes.sawProductAvailability === true) {
      return {
        requiresSize: false,
        verificationState: 'verified_in_stock',
        status: 'in_stock',
        label: 'În stoc (Verificat)',
        availableSizes: [],
        hasDesiredSize: true,
        isVerified: true,
      };
    }

    const oosPattern = storeConfig?.scraperConfig?.stockOosRegex
      ? new RegExp(storeConfig.scraperConfig.stockOosRegex, 'i')
      : /\b(?:stoc\s+epuizat|out\s+of\s+stock|indisponibil\s+momentan)\b/i;

    const mainText = cleanText($('main, .product-essential, .product-main, .product-page-pricing, h1').parent().text())
      || cleanText($('body').text()).slice(0, 6000);

    if (oosPattern.test(mainText)) {
      return {
        requiresSize: false,
        verificationState: 'verified_out_of_stock',
        status: 'out_of_stock',
        label: 'Stoc epuizat',
        availableSizes: [],
        hasDesiredSize: false,
        isVerified: true,
      };
    }
    if (/\b(?:în\s+stoc|in\s+stoc|livrare\s+din\s+stoc|adaugă\s+în\s+coș)\b/i.test(mainText)) {
      return {
        requiresSize: false,
        verificationState: 'verified_in_stock',
        status: 'in_stock',
        label: 'În stoc (Verificat)',
        availableSizes: [],
        hasDesiredSize: true,
        isVerified: true,
      };
    }

    return {
      requiresSize: false,
      verificationState: 'unverified_unknown',
      status: 'unknown',
      label: 'Verifică stocul pe site',
      availableSizes: [],
      hasDesiredSize: null,
      isVerified: false,
    };
  }

  // Sized categories: shoes | clothes
  // 1. JSON-LD variant sizes
  let resolved = jsonLdRes.foundSizes ? jsonLdRes : null;

  // 2. eMAG embedded characteristics (family/color pages keep all sizes here)
  if (!resolved) {
    const emagRes = extractSizesFromEmagCharacteristics(html, category);
    if (emagRes.foundSizes) resolved = emagRes;
  }

  // 3. Magento spConfig hydration
  if (!resolved) {
    const magentoRes = extractSizesFromMagentoInit($, category);
    if (magentoRes.foundSizes) resolved = magentoRes;
  }

  // 4. __NEXT_DATA__ / __APOLLO_STATE__ / __INITIAL_STATE__
  if (!resolved) {
    const hydRes = extractSizesFromHydration($, html, category);
    if (hydRes.foundSizes) resolved = hydRes;
  }

  // 5. Scoped DOM size containers (>= 2 tokens required)
  if (!resolved) {
    const domRes = extractSizesFromDom($, category, storeConfig);
    if (domRes.foundSizes) resolved = domRes;
  }

  if (resolved) {
    const sortedAvail = sortSizes(resolved.available, category);
    if (!target) {
      if (sortedAvail.length > 0) {
        return {
          requiresSize: true,
          verificationState: 'verified_in_stock',
          status: 'in_stock',
          label: `Mărimi în stoc: ${sortedAvail.slice(0, 6).join(', ')}`,
          availableSizes: sortedAvail,
          hasDesiredSize: null,
          isVerified: true,
        };
      }
      return {
        requiresSize: true,
        verificationState: 'verified_out_of_stock',
        status: 'out_of_stock',
        label: 'Stoc epuizat',
        availableSizes: [],
        hasDesiredSize: false,
        isVerified: true,
      };
    }

    const has = sortedAvail.includes(target);
    return {
      requiresSize: true,
      verificationState: has ? 'verified_in_stock' : 'verified_out_of_stock',
      status: has ? 'in_stock' : 'out_of_stock',
      label: has ? `În stoc (${target})` : `Epuizat mărimea ${target}`,
      availableSizes: sortedAvail,
      hasDesiredSize: has,
      isVerified: true,
    };
  }

  if (jsonLdRes.sawProductAvailability === false) {
    return {
      requiresSize: true,
      verificationState: 'verified_out_of_stock',
      status: 'out_of_stock',
      label: 'Stoc epuizat',
      availableSizes: [],
      hasDesiredSize: false,
      isVerified: true,
    };
  }

  return {
    requiresSize: true,
    verificationState: 'unverified_unknown',
    status: 'unknown',
    label: target ? `Verifică mărimea ${target} pe site` : 'Stoc neverificat',
    availableSizes: [],
    hasDesiredSize: null,
    isVerified: false,
  };
}

module.exports = {
  extractMetadataFromHtml,
  extractPriceFromHtml,
  extractStockAndSizesFromHtml,
  extractSlugFromUrl,
  normalizeSizeToken,
};
