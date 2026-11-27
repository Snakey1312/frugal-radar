'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const cheerio = require('cheerio');

const { isSafePublicUrl, safeFetch, storeFetch, circuitBreaker } = require('./http-client');
const { parseRoPrice, normalizeText } = require('./matching');

const STORES_PATH = path.join(__dirname, '..', 'data', 'stores.json');

let cachedCatalog = null;

function loadStoresCatalog() {
  if (!cachedCatalog) {
    const raw = fs.readFileSync(STORES_PATH, 'utf8');
    cachedCatalog = JSON.parse(raw);
  }
  return cachedCatalog;
}

function loadStores() {
  const catalog = loadStoresCatalog();
  return Array.isArray(catalog.stores) ? catalog.stores : [];
}

function formatDeliveryDays(deliveryDays) {
  if (!deliveryDays) return '2-4 zile';
  if (typeof deliveryDays === 'string') return deliveryDays;
  if (deliveryDays.label) return deliveryDays.label;
  if (deliveryDays.min != null && deliveryDays.max != null) {
    return `${deliveryDays.min}-${deliveryDays.max} zile`;
  }
  return '2-4 zile';
}

function getPublicStoresSummary() {
  const catalog = loadStoresCatalog();
  const stores = loadStores();
  const healthMap = circuitBreaker.getAllHealth() || {};

  return {
    total: stores.length,
    membershipPrograms: catalog.membershipPrograms || [],
    stores: stores.map((store) => {
      const h = healthMap[store.id] || { state: 'CLOSED', consecutiveFailures: 0, lastFailureKind: null, cooldownRemainingMs: 0 };
      const channels = store.shipping?.channels || {};
      let uiState = 'healthy';
      if (h.state === 'OPEN') {
        uiState = h.lastFailureKind === 'bot_blocked' ? 'blocked' : h.lastFailureKind === 'parse_drift' ? 'parse_error' : 'degraded';
      } else if (h.state === 'HALF_OPEN' || (h.consecutiveFailures && h.consecutiveFailures > 0)) {
        uiState = 'degraded';
      } else if (store.ingestion?.liveVerifyCapable === false) {
        uiState = 'serper_or_manual';
      }

      return {
        id: store.id,
        name: store.name,
        domains: store.domains || [],
        vertical: store.vertical,
        categories: store.categories || [],
        businessModel: store.businessModel,
        shippingSummary: {
          easyboxAvailable: Boolean(channels.easybox?.available),
          easyboxFee: channels.easybox?.fee ?? null,
          courierFee: channels.courier?.fee ?? null,
          freeThreshold: channels.courier?.freeThreshold ?? channels.easybox?.freeThreshold ?? null,
          clickAndCollect: Boolean(channels.clickAndCollect?.available),
          bulkyPolicy: store.shipping?.bulkyPolicy || 'standard',
          deliveryDays: formatDeliveryDays(store.shipping?.deliveryDays),
          membershipProgram: store.shipping?.membershipProgram?.programId || null,
          rambursAllowed: store.payment?.ramburs?.allowed !== false,
          rambursFee: store.payment?.ramburs?.fee ?? 0,
          rambursNonRefundable: Boolean(store.payment?.ramburs?.nonRefundableOnReturn),
        },
        returns: store.returns || null,
        ingestion: {
          tier: store.ingestion?.tier ?? 4,
          adapterType: store.ingestion?.adapterType || 'manual_link',
          liveVerifyCapable: store.ingestion?.liveVerifyCapable !== false,
          antiBotLevel: store.ingestion?.antiBotLevel || 'unknown',
        },
        health: {
          state: uiState,
          circuitState: h.state || 'CLOSED',
          reason: h.lastFailureKind || (store.ingestion?.liveVerifyCapable === false ? 'anti_bot_guarded' : null),
          retryAfterSec: Math.ceil((h.cooldownRemainingMs || 0) / 1000),
        },
      };
    }),
  };
}

function buildFallbackStore(storeIdOrName, rawUrl) {
  let domain = 'ro';
  if (rawUrl) {
    try {
      domain = new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
    } catch { /* ignore */ }
  }
  const displayName = (typeof storeIdOrName === 'string' && storeIdOrName.trim())
    ? storeIdOrName.trim()
    : (domain !== 'ro' ? domain : 'Magazin RO');
  const slug = normalizeText(displayName).replace(/\s+/g, '_') || 'ro';

  return {
    id: `ext_${slug}`,
    name: displayName,
    aliases: [],
    domains: [domain],
    platform: 'custom',
    businessModel: 'unknown',
    vertical: 'external',
    categories: [],
    shipping: {
      channels: {
        easybox: { available: true, fee: 14.9, freeThreshold: 250, requiresOnlinePay: false, maxWeightKg: 20 },
        fanbox: { available: false, fee: null, freeThreshold: null },
        courier: { available: true, fee: 19.9, freeThreshold: 250, requiresOnlinePay: false, maxWeightKg: null },
        clickAndCollect: { available: false, fee: null, freeThreshold: null },
      },
      bulkyPolicy: 'standard',
      deliveryDays: { min: 2, max: 4, label: '2-4 zile' },
      membershipProgram: null,
    },
    payment: {
      cardOnline: true,
      ramburs: { allowed: true, fee: 5.0, nonRefundableOnReturn: false, maxOrderRon: 5000, maxWeightKg: null, disablesFreeShipping: false, disabledOnChannels: [] },
    },
    returns: { days: 14, freeReturn: false, freeReturnMinOrderRon: null, notes: '' },
    ingestion: {
      tier: 3,
      adapterType: 'serper_only',
      liveVerifyCapable: true,
      antiBotLevel: 'unknown',
      searchUrlTemplate: '',
      scraperConfig: null,
    },
  };
}

function resolveStore(storeIdOrName, url) {
  const stores = loadStores();

  if (storeIdOrName && typeof storeIdOrName === 'string') {
    const idLower = storeIdOrName.trim().toLowerCase();
    const byId = stores.find((s) => s.id === idLower);
    if (byId) return byId;
  }

  if (url && typeof url === 'string') {
    try {
      const host = new URL(url).hostname.replace(/^(?:www|m)\./i, '').toLowerCase();
      const byDomain = stores.find((s) =>
        Array.isArray(s.domains) && s.domains.some((d) => {
          const dom = d.toLowerCase();
          return host === dom || host.endsWith(`.${dom}`);
        })
      );
      if (byDomain) return byDomain;
    } catch { /* ignore invalid URL */ }
  }

  if (storeIdOrName && typeof storeIdOrName === 'string') {
    const lowerName = storeIdOrName.trim().toLowerCase();
    const normName = normalizeText(lowerName);
    const byNameOrAlias = stores.find((s) => {
      if (lowerName === s.name.toLowerCase() || normName === normalizeText(s.name)) return true;
      if (Array.isArray(s.aliases) && s.aliases.some((a) => lowerName.includes(a.toLowerCase()))) return true;
      if (Array.isArray(s.domains) && s.domains.some((d) => lowerName.includes(d.toLowerCase()))) return true;
      return false;
    });
    if (byNameOrAlias) return byNameOrAlias;
  }

  return buildFallbackStore(storeIdOrName, url);
}

// --- Pure Response Parsers (testable with offline fixtures) ---

function parseAltexFenrirResponse(data, store, query = '') {
  const products = Array.isArray(data?.products) ? data.products : [];
  const baseUrl = store?.ingestion?.scraperConfig?.baseUrl || 'https://altex.ro';
  const results = [];

  for (const p of products) {
    if (!p || !p.name) continue;
    const price = parseRoPrice(p.price ?? p.special_price);
    if (!price || price <= 0) continue;

    const url = p.url_key && p.sku
      ? `${baseUrl}/${p.url_key}/cpd/${p.sku}/`
      : (p.url ? new URL(p.url, baseUrl).toString() : `${baseUrl}/cauta/?q=${encodeURIComponent(query)}`);

    if (!isSafePublicUrl(url)) continue;

    const sellerRaw = p.seller_name || p.marketplace_seller || p.merchant_name || null;
    let sellerType = '1p';
    let sellerName = 'Altex';
    if (sellerRaw && !/\baltex|media\s*galaxy\b/i.test(String(sellerRaw))) {
      sellerType = '3p';
      sellerName = String(sellerRaw).trim();
    }

    results.push({
      storeId: store.id,
      title: String(p.name).trim(),
      url,
      price,
      inStock: p.is_in_stock !== false && p.stock_status !== 0 && p.stock_status !== 'OUT_OF_STOCK',
      gtin: p.ean || p.gtin || null,
      mpn: p.sku || null,
      priceSource: 'tier2_live',
      marketplace: { sellerType, sellerName, isGeniusEligible: null },
    });
  }

  return results;
}

function parseMagento2GraphqlResponse(json, store) {
  const items = Array.isArray(json?.data?.products?.items) ? json.data.products.items : [];
  const cfg = store?.ingestion?.scraperConfig || {};
  const baseUrl = cfg.baseUrl || `https://${store.domains?.[0] || 'gymbeam.ro'}`;
  const suffix = cfg.urlSuffix ?? '.html';
  const results = [];

  for (const it of items) {
    if (!it || !it.name || !it.url_key) continue;
    const priceObj = it.price_range?.minimum_price?.final_price;
    if (priceObj?.currency && !/^(ron|lei)$/i.test(String(priceObj.currency))) continue;
    const price = parseRoPrice(priceObj?.value);
    if (!price || price <= 0) continue;

    const cleanKey = String(it.url_key).replace(/^\//, '');
    const url = cleanKey.endsWith('.html') ? `${baseUrl}/${cleanKey}` : `${baseUrl}/${cleanKey}${suffix}`;
    if (!isSafePublicUrl(url)) continue;

    results.push({
      storeId: store.id,
      title: String(it.name).trim(),
      url,
      price,
      inStock: it.stock_status !== 'OUT_OF_STOCK',
      mpn: it.sku || null,
      priceSource: 'tier2_live',
      marketplace: { sellerType: '1p', sellerName: store.name, isGeniusEligible: null },
    });
  }

  return results;
}

function parseShopifySuggestResponse(json, store) {
  const products = Array.isArray(json?.resources?.results?.products) ? json.resources.results.products : [];
  const cfg = store?.ingestion?.scraperConfig || {};
  const baseUrl = cfg.baseUrl || `https://${store.domains?.[0]}`;
  const results = [];

  for (const it of products) {
    if (!it || !it.title || !it.url) continue;
    const price = parseRoPrice(it.price ?? it.price_min);
    if (!price || price <= 0) continue;

    let fullUrl;
    try {
      fullUrl = new URL(it.url, baseUrl).toString();
    } catch {
      continue;
    }
    if (!isSafePublicUrl(fullUrl)) continue;

    results.push({
      storeId: store.id,
      title: String(it.title).trim(),
      url: fullUrl,
      price,
      inStock: it.available !== false,
      mpn: it.id ? String(it.id) : null,
      priceSource: 'tier2_live',
      marketplace: { sellerType: '1p', sellerName: store.name, isGeniusEligible: null },
    });
  }

  return results;
}

function parseVtexSearchResponse(json, store) {
  const products = Array.isArray(json) ? json : [];
  const cfg = store?.ingestion?.scraperConfig || {};
  const baseUrl = cfg.baseUrl || `https://${store.domains?.[0]}`;
  const results = [];

  for (const prod of products) {
    if (!prod) continue;
    const title = String(prod.productName || prod.productTitle || '').trim();
    const rawLink = prod.link || (prod.linkText ? `/${prod.linkText}/p` : '');
    if (!title || !rawLink) continue;

    let fullUrl;
    try {
      fullUrl = new URL(rawLink, baseUrl).toString();
    } catch {
      continue;
    }
    if (!isSafePublicUrl(fullUrl)) continue;

    const items = Array.isArray(prod.items) ? prod.items : [];
    let bestPrice = null;
    let inStock = false;
    let gtin = null;

    for (const skuItem of items) {
      if (!gtin && skuItem?.ean) gtin = String(skuItem.ean);
      const sellers = Array.isArray(skuItem?.sellers) ? skuItem.sellers : [];
      for (const seller of sellers) {
        const offer = seller?.commertialOffer;
        if (!offer) continue;
        const p = parseRoPrice(offer.Price ?? offer.ListPrice);
        const qty = Number(offer.AvailableQuantity ?? 0);
        const avail = offer.IsAvailable !== false && qty > 0;
        if (p && p > 0) {
          if (avail && (!inStock || bestPrice === null || p < bestPrice)) {
            bestPrice = p;
            inStock = true;
          } else if (!inStock && bestPrice === null) {
            bestPrice = p;
          }
        }
      }
    }

    if (!bestPrice || bestPrice <= 0) continue;

    results.push({
      storeId: store.id,
      title,
      url: fullUrl,
      price: bestPrice,
      inStock,
      gtin,
      mpn: prod.productReference || prod.productId || null,
      priceSource: 'tier2_live',
      marketplace: { sellerType: '1p', sellerName: store.name, isGeniusEligible: null },
    });
  }

  return results;
}

function parseEmagPriceText(priceEl, $) {
  if (!priceEl || priceEl.length === 0) return null;
  const clone = priceEl.clone();
  const sup = clone.find('sup').first();
  if (sup.length > 0) {
    const dec = sup.text().replace(/[^\d]/g, '');
    sup.replaceWith(dec ? `,${dec}` : '');
  }
  const raw = clone.text().replace(/\s+/g, ' ').trim();
  return parseRoPrice(raw);
}

function parseEmagHtml(html, store) {
  if (!html || typeof html !== 'string') return [];
  const $ = cheerio.load(html);
  const results = [];

  $('.card-item').slice(0, 12).each((_, el) => {
    const $card = $(el);
    const title = (
      $card.attr('data-name') ||
      $card.find('.card-v2-title').first().text() ||
      $card.find('a.js-product-url').first().attr('title') ||
      ''
    ).replace(/\s+/g, ' ').trim();

    const href = (
      $card.find('a.card-v2-title').first().attr('href') ||
      $card.find('a.js-product-url').first().attr('href') ||
      $card.find('a[href*="/pd/"]').first().attr('href') ||
      ''
    ).trim();

    if (!title || !href) return;
    let fullUrl;
    try {
      fullUrl = new URL(href, 'https://www.emag.ro').toString();
    } catch {
      return;
    }
    if (!isSafePublicUrl(fullUrl)) return;

    const price = parseEmagPriceText($card.find('.product-new-price').first(), $);
    if (!price || price <= 0) return;

    const cardText = $card.text().replace(/\s+/g, ' ').trim();
    const inStock = !/stoc\s+epuizat|indisponibil/i.test(cardText);

    const hasGenius =
      $card.find('[class*="genius"], .badge-genius').length > 0 ||
      /\bgenius\b/i.test($card.find('.card-v2-badge, .emag-genius-badge').text());

    let sellerType = 'unknown';
    let sellerName = null;
    if (/v[aâ]ndut\s+(?:și|si)\s+livrat\s+de\s+emag/i.test(cardText)) {
      sellerType = '1p';
      sellerName = 'eMAG';
    } else {
      const m = cardText.match(/V[aâ]ndut\s+de:?\s*([A-Za-z0-9 .&-]{2,40})/i);
      if (m) {
        sellerName = m[1].trim();
        sellerType = /\bemag\b/i.test(sellerName) ? '1p' : '3p';
      }
    }

    results.push({
      storeId: store?.id || 'emag',
      title,
      url: fullUrl,
      price,
      inStock,
      priceSource: 'tier2_live',
      marketplace: {
        sellerType,
        sellerName,
        isGeniusEligible: hasGenius ? true : null,
      },
    });
  });

  return results;
}

function parseCheerioCatalogHtml(html, store) {
  if (!html || typeof html !== 'string') return [];
  const cfg = store?.ingestion?.scraperConfig || {};
  const baseUrl = cfg.baseUrl || `https://${store?.domains?.[0] || 'example.ro'}`;
  const $ = cheerio.load(html);
  const results = [];
  const oosRegex = cfg.stockOosRegex ? new RegExp(cfg.stockOosRegex, 'i') : /\b(?:stoc\s+epuizat|indisponibil|out\s+of\s+stock)\b/i;

  if (cfg.cardSelector) {
    $(cfg.cardSelector).slice(0, 12).each((_, el) => {
      const $card = $(el);

      const $titleEl = cfg.titleSelector ? $card.find(cfg.titleSelector).first() : $card.find('a').first();
      const title = (
        $titleEl.attr('title') ||
        $titleEl.attr('data-name') ||
        $titleEl.text() ||
        $card.attr('data-name') ||
        ''
      ).replace(/\s+/g, ' ').trim();

      const $linkEl = cfg.linkSelector ? $card.find(cfg.linkSelector).first() : $titleEl;
      const rawHref = ($linkEl.attr('href') || $card.find('a[href]').first().attr('href') || '').trim();
      if (!title || !rawHref) return;

      let fullUrl;
      try {
        fullUrl = new URL(rawHref, baseUrl).toString();
      } catch {
        return;
      }
      if (!isSafePublicUrl(fullUrl)) return;

      const $priceEl = cfg.priceSelector ? $card.find(cfg.priceSelector).first() : $card.find('[itemprop="price"], .price').first();
      const rawPrice = $priceEl.attr('content') || $priceEl.attr('data-price') || $priceEl.text() || '';
      const price = parseRoPrice(rawPrice);
      if (!price || price <= 0) return;

      const cardText = $card.text().replace(/\s+/g, ' ').trim();
      const inStock = !oosRegex.test(cardText);

      results.push({
        storeId: store.id,
        title,
        url: fullUrl,
        price,
        inStock,
        priceSource: 'tier2_live',
        marketplace: {
          sellerType: store.businessModel === '1p' ? '1p' : 'unknown',
          sellerName: store.businessModel === '1p' ? store.name : null,
          isGeniusEligible: null,
        },
      });
    });
  }

  // Fallback to JSON-LD ItemList / Product on catalog page when cards didn't match
  if (results.length === 0) {
    $('script[type="application/ld+json"]').each((_, el) => {
      const raw = $(el).contents().text().trim();
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw);
        const list = [];
        const collect = (node) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) return node.forEach(collect);
          if (Array.isArray(node['@graph'])) collect(node['@graph']);
          if (Array.isArray(node.itemListElement)) collect(node.itemListElement);
          if (node.item && typeof node.item === 'object') collect(node.item);
          if (node['@type'] === 'Product' || (Array.isArray(node['@type']) && node['@type'].includes('Product'))) {
            list.push(node);
          }
        };
        collect(parsed);

        for (const prod of list.slice(0, 10)) {
          const title = String(prod.name || '').trim();
          const offers = Array.isArray(prod.offers) ? prod.offers[0] : prod.offers;
          const rawUrl = prod.url || offers?.url || '';
          if (!title || !rawUrl) continue;
          let fullUrl;
          try {
            fullUrl = new URL(rawUrl, baseUrl).toString();
          } catch {
            continue;
          }
          if (!isSafePublicUrl(fullUrl)) continue;
          if (offers?.priceCurrency && !/^(ron|lei)$/i.test(String(offers.priceCurrency))) continue;
          const price = parseRoPrice(offers?.price ?? offers?.lowPrice);
          if (!price || price <= 0) continue;

          const avail = String(offers?.availability || '').toLowerCase();
          const inStock = !avail.includes('outofstock') && !avail.includes('soldout');
          results.push({
            storeId: store.id,
            title,
            url: fullUrl,
            price,
            inStock,
            gtin: prod.gtin13 || prod.gtin || null,
            mpn: prod.mpn || prod.sku || null,
            priceSource: 'tier2_live',
            marketplace: {
              sellerType: store.businessModel === '1p' ? '1p' : 'unknown',
              sellerName: store.businessModel === '1p' ? store.name : null,
              isGeniusEligible: null,
            },
          });
        }
      } catch { /* ignore malformed JSON-LD */ }
    });
  }

  return results;
}

// --- Live Adapter Runners ---

async function runAltexFenrir(store, query, { fetchFn = storeFetch } = {}) {
  const template = store.ingestion?.scraperConfig?.apiUrl || 'https://fenrir.altex.ro/v2/catalog/search/{query}?size=10';
  const url = template.replace('{query}', encodeURIComponent(query));
  const res = await fetchFn(store.id, url, {
    headers: { Origin: 'https://altex.ro', Referer: 'https://altex.ro/' },
    timeoutMs: 3600,
    useImpit: true,
  });
  if (!res || !res.ok) return [];
  if (!res.json) {
    circuitBreaker.recordFailure(store.id, 'parse_drift', 'Expected JSON from Altex Fenrir');
    return [];
  }
  return parseAltexFenrirResponse(res.json, store, query);
}

async function runMagento2Graphql(store, query, { fetchFn = storeFetch } = {}) {
  const cfg = store.ingestion?.scraperConfig || {};
  const graphqlUrl = cfg.graphqlUrl;
  if (!graphqlUrl) return [];

  const cleanQ = query.replace(/\b\d+(?:[.,]\d+)?\s*(?:g|kg|ml|l)\b/gi, '').replace(/\s+/g, ' ').trim();
  const queriesToTry = cleanQ && cleanQ !== query ? [query, cleanQ] : [query];
  const customHeaders = cfg.headers && typeof cfg.headers === 'object' ? cfg.headers : {};

  for (const qText of queriesToTry) {
    const gql = `{products(search:${JSON.stringify(qText)},pageSize:8){items{name sku url_key stock_status price_range{minimum_price{final_price{value currency}}}}}}`;
    const url = `${graphqlUrl}?query=${encodeURIComponent(gql)}`;
    const res = await fetchFn(store.id, url, {
      headers: customHeaders,
      timeoutMs: 3600,
      useImpit: cfg.useImpit === true,
    });
    if (!res || !res.ok) return [];
    if (!res.json) {
      circuitBreaker.recordFailure(store.id, 'parse_drift', 'Expected JSON from Magento2 GraphQL');
      return [];
    }
    const parsed = parseMagento2GraphqlResponse(res.json, store);
    if (parsed.length > 0) return parsed;
  }
  return [];
}

async function runShopifySuggest(store, query, { fetchFn = storeFetch } = {}) {
  const baseUrl = store.ingestion?.scraperConfig?.baseUrl || `https://${store.domains?.[0]}`;
  const url = `${baseUrl}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=8`;
  const res = await fetchFn(store.id, url, { timeoutMs: 3500, useImpit: false });
  if (!res || !res.ok) return [];
  if (!res.json) {
    circuitBreaker.recordFailure(store.id, 'parse_drift', 'Expected JSON from Shopify suggest');
    return [];
  }
  return parseShopifySuggestResponse(res.json, store);
}

async function runVtexSearch(store, query, { fetchFn = storeFetch } = {}) {
  const baseUrl = store.ingestion?.scraperConfig?.baseUrl || `https://${store.domains?.[0]}`;
  const url = `${baseUrl}/api/catalog_system/pub/products/search/${encodeURIComponent(query)}?_from=0&_to=7`;
  const res = await fetchFn(store.id, url, { timeoutMs: 3500, useImpit: false });
  if (!res || !res.ok) return [];
  if (!res.json) {
    circuitBreaker.recordFailure(store.id, 'parse_drift', 'Expected JSON from VTEX search');
    return [];
  }
  return parseVtexSearchResponse(res.json, store);
}

async function runEmagHtml(store, query, { fetchFn = storeFetch } = {}) {
  const template = store.ingestion?.searchUrlTemplate || 'https://www.emag.ro/search/{query}';
  const url = template.replace('{query}', encodeURIComponent(query));
  const res = await fetchFn(store.id, url, { timeoutMs: 3600, useImpit: true });
  if (!res || !res.ok || !res.text) return [];
  return parseEmagHtml(res.text, store);
}

async function runCheerioCatalog(store, query, { fetchFn = storeFetch } = {}) {
  const template = store.ingestion?.searchUrlTemplate;
  if (!template) return [];
  const url = template.replace('{query}', encodeURIComponent(query));
  const res = await fetchFn(store.id, url, { timeoutMs: 3600, useImpit: true });
  if (!res || !res.ok || !res.text) return [];
  return parseCheerioCatalogHtml(res.text, store);
}

const ADAPTER_RUNNERS = {
  altex_fenrir: runAltexFenrir,
  magento2_graphql: runMagento2Graphql,
  shopify_suggest: runShopifySuggest,
  vtex_search: runVtexSearch,
  emag_html: runEmagHtml,
  cheerio_catalog: runCheerioCatalog,
};

const ADAPTER_QUERY_REWRITES = [
  [/\bair\s+max\s+tn\b/i, 'air max plus tn'],
  [/\btriple\s+black\b|\bblack\b/i, 'negru'],
  [/\bwhite\b/i, 'alb'],
  [/\bred\b/i, 'rosu'],
  [/\bblue\b/i, 'albastru'],
  [/\bgrey\b|\bgray\b/i, 'gri'],
];

// Romanian storefronts index colors in Romanian and the Nike "TN" nickname as
// "Air Max Plus TN". Rewrite only the Stage-1 adapter query; relevance scoring
// still uses the user's original query, so wrong models/colors stay rejected.
function buildAdapterSearchQuery(query) {
  let q = normalizeText(query);
  for (const [pattern, replacement] of ADAPTER_QUERY_REWRITES) {
    q = q.replace(pattern, replacement);
  }
  return q.replace(/\b(\w+)(?:\s+\1)+\b/gi, '$1').replace(/\s+/g, ' ').trim();
}

async function runStoreAdapters(query, category, { cache = null, forceRefresh = false, storeIds = null, fetchFn = storeFetch } = {}) {
  const stores = loadStores();
  const searchQuery = buildAdapterSearchQuery(query);
  const normQuery = normalizeText(searchQuery);
  const filterSet = Array.isArray(storeIds) && storeIds.length > 0 ? new Set(storeIds) : null;

  const targetStores = stores.filter((store) => {
    const adapterType = store.ingestion?.adapterType;
    if (!adapterType || !ADAPTER_RUNNERS[adapterType]) return false;
    if (filterSet && !filterSet.has(store.id)) return false;
    if (category && category !== 'general' && category !== 'auto') {
      if (!Array.isArray(store.categories) || !store.categories.includes(category)) {
        return false;
      }
    }
    return circuitBreaker.canRequest(store.id);
  });

  if (targetStores.length === 0) {
    return { matches: [], cacheStatus: 'miss', cachedAt: Date.now() };
  }

  let anyStale = false;
  let allHit = true;
  let newestCachedAt = 0;

  const settled = await Promise.allSettled(
    targetStores.map(async (store) => {
      const runner = ADAPTER_RUNNERS[store.ingestion.adapterType];
      const cacheKey = `scraper:${store.id}:${normQuery}`;

      if (cache && typeof cache.getOrFetch === 'function') {
        const res = await cache.getOrFetch(
          cacheKey,
          async () => runner(store, searchQuery, { fetchFn }),
          {
            freshMs: 10 * 60_000,
            staleMs: 60 * 60_000,
            negativeMs: 90_000,
            forceRefresh,
          }
        );
        if (res.status === 'STALE') anyStale = true;
        if (res.status !== 'HIT') allHit = false;
        if (res.cachedAt && res.cachedAt > newestCachedAt) newestCachedAt = res.cachedAt;
        return Array.isArray(res.value) ? res.value : [];
      }

      allHit = false;
      return runner(store, searchQuery, { fetchFn });
    })
  );

  const matches = settled
    .filter((s) => s.status === 'fulfilled' && Array.isArray(s.value))
    .flatMap((s) => s.value);

  const cacheStatus = allHit ? 'hit' : anyStale ? 'stale' : 'miss';
  return {
    matches,
    cacheStatus,
    cachedAt: newestCachedAt || Date.now(),
  };
}

// --- Stage 1 Serper Shopping + Web RO (NO Stage 1 HTML fetching) ---

const IGNORED_SERP_HOST_RE = /(?:^|\.)(?:youtube\.com|youtu\.be|facebook\.com|instagram\.com|tiktok\.com|wikipedia\.org|reddit\.com|pinterest\.com)$/i;

async function searchSerperShoppingRo(query, serperKey, { cache = null, forceRefresh = false, fetchFn = safeFetch } = {}) {
  const emptyInfo = { used: false, shoppingCount: 0, webCount: 0, error: null };
  const trimmedKey = String(serperKey || '').trim();
  if (!trimmedKey) {
    return { matches: [], info: emptyInfo, cacheStatus: 'miss', cachedAt: Date.now() };
  }

  const normQuery = normalizeText(query);
  const cacheKey = `serper:ro:${normQuery}`;

  const executeSerper = async () => {
    const info = { used: true, shoppingCount: 0, webCount: 0, error: null };
    const headers = { 'X-API-KEY': trimmedKey, 'Content-Type': 'application/json' };
    const matches = [];

    const [shopRes, webRes] = await Promise.allSettled([
      fetchFn('https://google.serper.dev/shopping', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q: query, gl: 'ro', hl: 'ro', num: 20 }),
        timeoutMs: 3800,
      }),
      fetchFn('https://google.serper.dev/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q: `${query} pret`, gl: 'ro', hl: 'ro', num: 15 }),
        timeoutMs: 3800,
      }),
    ]);

    if (shopRes.status === 'fulfilled') {
      const sr = shopRes.value;
      if (!sr || !sr.ok) {
        info.error = sr?.error || `Serper HTTP ${sr?.status || 0}`;
      } else if (sr.json) {
        const shopping = Array.isArray(sr.json.shopping) ? sr.json.shopping : [];
        for (const item of shopping) {
          if (!item || !item.title || !item.link) continue;
          const safeUrl = isSafePublicUrl(item.link);
          if (!safeUrl) continue;
          const priceNum = parseRoPrice(String(item.price || ''));
          if (!priceNum || priceNum <= 0) continue;

          info.shoppingCount++;
          matches.push({
            storeId: null,
            customStoreName: item.source || safeUrl.hostname.replace(/^www\./, ''),
            title: String(item.title).trim(),
            url: safeUrl.toString(),
            price: priceNum,
            inStock: true,
            priceSource: 'tier3_serper',
            source: 'serper',
          });
        }
      }
    } else {
      info.error = shopRes.reason?.message || 'Serper shopping failed';
    }

    if (webRes.status === 'fulfilled' && webRes.value?.ok && webRes.value?.json) {
      const organic = Array.isArray(webRes.value.json.organic) ? webRes.value.json.organic.slice(0, 12) : [];
      const seenHosts = new Set(matches.map((m) => {
        try { return new URL(m.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
      }));

      for (const o of organic) {
        if (!o || !o.link || !o.title) continue;
        const safeUrl = isSafePublicUrl(o.link);
        if (!safeUrl) continue;
        const host = safeUrl.hostname.replace(/^www\./, '').toLowerCase();
        if (IGNORED_SERP_HOST_RE.test(host)) continue;
        if (seenHosts.has(host)) continue;
        seenHosts.add(host);

        let price = null;
        if (o.priceRange) {
          price = parseRoPrice(String(o.priceRange));
        }
        if (!price && o.snippet) {
          const snipMatch = String(o.snippet).match(/(\d{1,3}(?:[.\s]\d{3})*|\d+)(?:[,.](\d{1,2}))?\s*(?:lei|ron)\b/i);
          if (snipMatch) price = parseRoPrice(snipMatch[0]);
        }

        info.webCount++;
        matches.push({
          storeId: null,
          customStoreName: host,
          title: String(o.title).trim(),
          url: safeUrl.toString(),
          price: price && price > 0 ? price : null,
          needsPriceEnrichment: !(price && price > 0),
          inStock: true,
          priceSource: 'tier3_serper',
          source: 'serper',
        });
      }
    }

    return { matches: matches.slice(0, 24), info };
  };

  if (cache && typeof cache.getOrFetch === 'function') {
    const res = await cache.getOrFetch(cacheKey, executeSerper, {
      freshMs: 15 * 60_000,
      staleMs: 60 * 60_000,
      negativeMs: 90_000,
      forceRefresh,
    });
    const val = res.value || { matches: [], info: { ...emptyInfo, used: true } };
    return {
      matches: val.matches || [],
      info: val.info || { ...emptyInfo, used: true },
      cacheStatus: res.status === 'HIT' ? 'hit' : res.status === 'STALE' ? 'stale' : 'miss',
      cachedAt: res.cachedAt || Date.now(),
    };
  }

  const fresh = await executeSerper();
  return {
    ...fresh,
    cacheStatus: 'miss',
    cachedAt: Date.now(),
  };
}

module.exports = {
  loadStores,
  loadStoresCatalog,
  getPublicStoresSummary,
  resolveStore,
  runStoreAdapters,
  buildAdapterSearchQuery,
  searchSerperShoppingRo,
  // Pure parsers exported for fixture testing
  parseAltexFenrirResponse,
  parseMagento2GraphqlResponse,
  parseShopifySuggestResponse,
  parseVtexSearchResponse,
  parseEmagHtml,
  parseCheerioCatalogHtml,
};
