const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = process.env.PORT || 3456;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
};

/**
 * Romanian stores catalog with real shipping rules, Genius perks,
 * cash-on-delivery (ramburs) fees, and direct search URL builders.
 */
const ROMANIAN_STORES = [
  {
    id: 'emag',
    name: 'eMAG',
    domain: 'emag.ro',
    categories: ['electronics', 'shoes', 'clothes', 'supplements', 'general'],
    shipping: { baseFee: 19.99, easyboxFee: 14.99, freeThreshold: 200, geniusFree: 'emag', rambursFee: 5.0, deliveryDays: '1-2 zile' },
    searchUrl: (q) => `https://www.emag.ro/search/${encodeURIComponent(q)}`,
  },
  {
    id: 'altex',
    name: 'Altex',
    domain: 'altex.ro',
    categories: ['electronics', 'general'],
    shipping: { baseFee: 14.9, easyboxFee: 9.9, freeThreshold: 200, geniusFree: null, rambursFee: 0, deliveryDays: '1-2 zile' },
    searchUrl: (q) => `https://altex.ro/cauta/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'gymbeam',
    name: 'GymBeam.ro',
    domain: 'gymbeam.ro',
    categories: ['supplements', 'clothes', 'general'],
    shipping: { baseFee: 14.9, easyboxFee: 11.9, freeThreshold: 199, geniusFree: null, rambursFee: 5.0, deliveryDays: '1-2 zile' },
    searchUrl: (q) => `https://gymbeam.ro/catalogsearch/result/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'trendyol',
    name: 'Trendyol.ro',
    domain: 'trendyol.com/ro',
    categories: ['shoes', 'clothes', 'supplements', 'general'],
    shipping: { baseFee: 14.99, easyboxFee: 9.99, freeThreshold: 150, geniusFree: null, rambursFee: 0, deliveryDays: '3-5 zile' },
    searchUrl: (q) => `https://www.trendyol.com/ro/sr?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'fashiondays',
    name: 'Fashion Days',
    domain: 'fashiondays.ro',
    categories: ['shoes', 'clothes'],
    shipping: { baseFee: 16.99, easyboxFee: 11.99, freeThreshold: 250, geniusFree: 'fashion', rambursFee: 5.0, deliveryDays: '1-2 zile' },
    searchUrl: (q) => `https://www.fashiondays.ro/search/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'zalando',
    name: 'Zalando.ro',
    domain: 'zalando.ro',
    categories: ['shoes', 'clothes'],
    shipping: { baseFee: 19.9, easyboxFee: 14.9, freeThreshold: 130, geniusFree: null, rambursFee: 0, deliveryDays: '3-6 zile' },
    searchUrl: (q) => `https://www.zalando.ro/catalog/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'aboutyou',
    name: 'ABOUT YOU',
    domain: 'aboutyou.ro',
    categories: ['shoes', 'clothes'],
    shipping: { baseFee: 0, easyboxFee: 0, freeThreshold: 0, geniusFree: null, rambursFee: 0, deliveryDays: '3-5 zile' },
    searchUrl: (q) => `https://www.aboutyou.ro/cautare?term=${encodeURIComponent(q)}`,
  },
  {
    id: 'epantofi',
    name: 'epantofi.ro',
    domain: 'epantofi.ro',
    categories: ['shoes'],
    shipping: { baseFee: 19.0, easyboxFee: 14.0, freeThreshold: 199, geniusFree: null, rambursFee: 0, deliveryDays: '2-3 zile' },
    searchUrl: (q) => `https://www.epantofi.ro/cautare?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'answear',
    name: 'Answear.ro',
    domain: 'answear.ro',
    categories: ['shoes', 'clothes'],
    shipping: { baseFee: 19.9, easyboxFee: 14.9, freeThreshold: 250, geniusFree: null, rambursFee: 4.9, deliveryDays: '2-4 zile' },
    searchUrl: (q) => `https://answear.ro/k/${encodeURIComponent(q.replace(/\s+/g, '-').toLowerCase())}`,
  },
  {
    id: 'decathlon',
    name: 'Decathlon',
    domain: 'decathlon.ro',
    categories: ['shoes', 'clothes', 'supplements', 'general'],
    shipping: { baseFee: 19.99, easyboxFee: 14.99, freeThreshold: 250, geniusFree: null, rambursFee: 0, deliveryDays: '1-3 zile' },
    searchUrl: (q) => `https://www.decathlon.ro/search?Ntt=${encodeURIComponent(q)}`,
  },
  {
    id: 'flanco',
    name: 'Flanco',
    domain: 'flanco.ro',
    categories: ['electronics', 'general'],
    shipping: { baseFee: 19.9, easyboxFee: 12.9, freeThreshold: 250, geniusFree: null, rambursFee: 4.9, deliveryDays: '1-3 zile' },
    searchUrl: (q) => `https://www.flanco.ro/catalogsearch/result/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'pcgarage',
    name: 'PC Garage',
    domain: 'pcgarage.ro',
    categories: ['electronics'],
    shipping: { baseFee: 19.99, easyboxFee: 14.99, freeThreshold: 400, geniusFree: 'emag', rambursFee: 5.0, deliveryDays: '1-2 zile' },
    searchUrl: (q) => `https://www.pcgarage.ro/cauta/${encodeURIComponent(q)}`,
  },
  {
    id: 'vexio',
    name: 'Vexio',
    domain: 'vexio.ro',
    categories: ['electronics', 'general'],
    shipping: { baseFee: 18.9, easyboxFee: 14.9, freeThreshold: 500, geniusFree: null, rambursFee: 6.0, deliveryDays: '2-3 zile' },
    searchUrl: (q) => `https://www.vexio.ro/cautare/?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'drmax',
    name: 'Dr.Max',
    domain: 'drmax.ro',
    categories: ['supplements', 'general'],
    shipping: { baseFee: 14.99, easyboxFee: 9.99, freeThreshold: 199, geniusFree: null, rambursFee: 0, deliveryDays: '1-3 zile' },
    searchUrl: (q) => `https://www.drmax.ro/cautare?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'notino',
    name: 'Notino.ro',
    domain: 'notino.ro',
    categories: ['supplements', 'general'],
    shipping: { baseFee: 18.0, easyboxFee: 14.0, freeThreshold: 250, geniusFree: null, rambursFee: 5.0, deliveryDays: '2-3 zile' },
    searchUrl: (q) => `https://www.notino.ro/search.asp?exps=${encodeURIComponent(q)}`,
  },
  {
    id: 'elefant',
    name: 'elefant.ro',
    domain: 'elefant.ro',
    categories: ['general', 'supplements', 'clothes'],
    shipping: { baseFee: 16.99, easyboxFee: 9.99, freeThreshold: 199, geniusFree: null, rambursFee: 5.0, deliveryDays: '2-4 zile' },
    searchUrl: (q) => `https://www.elefant.ro/search?SearchTerm=${encodeURIComponent(q)}`,
  },
];

const SHOE_KEYWORDS = [
  'nike', 'adidas', 'puma', 'reebok', 'new balance', 'asics', 'salomon', 'converse',
  'vans', 'jordan', 'air force', 'air max', 'dunk', 'yeezy', 'ultraboost', 'gel-kayano',
  'pantofi', 'adidasi', 'adidași', 'ghete', 'cizme', 'bocanci', 'sandale', 'tenisi',
  'teniși', 'mocasini', 'sneakers', 'slapi', 'șlapi', 'papuci', 'hoka', 'skechers', 'timberland',
];

const CLOTHES_KEYWORDS = [
  'geaca', 'geacă', 'hanorac', 'tricou', 'pantaloni', 'blugi', 'jeans', 'rochie',
  'fusta', 'fustă', 'pulover', 'sacou', 'palton', 'jacheta', 'jachetă', 'camasa',
  'cămașă', 'trening', 'costum', 'vesta', 'vestă', 'nuptse', 'north face', 'columbia',
  'zara', 'mango', 'h&m', 'tommy hilfiger', 'calvin klein', 'ralph lauren', 'levis',
];

const SUPPLEMENT_KEYWORDS = [
  'protein', 'proteina', 'proteină', 'whey', 'creatina', 'creatină', 'pre workout', 'pre-workout',
  'veinz', 'gymbeam', 'bcaa', 'amino', 'vitamina', 'magneziu', 'omega', 'supliment', 'myprotein', 'optimum nutrition',
];

const ELECTRONICS_KEYWORDS = [
  'iphone', 'samsung', 'galaxy', 'xiaomi', 'laptop', 'macbook', 'lenovo', 'asus',
  'dell', 'hp', 'monitor', 'televizor', 'tv', 'oled', 'casti', 'căști', 'airpods',
  'sony', 'playstation', 'ps5', 'xbox', 'nintendo', 'placa video', 'rtx', 'ssd',
  'procesor', 'ryzen', 'intel', 'aspirator', 'dyson', 'espressor', 'philips', 'bosch',
];

function detectCategory(text) {
  const lower = (text || '').toLowerCase();
  if (SUPPLEMENT_KEYWORDS.some((kw) => lower.includes(kw))) return 'supplements';
  if (SHOE_KEYWORDS.some((kw) => lower.includes(kw))) return 'shoes';
  if (CLOTHES_KEYWORDS.some((kw) => lower.includes(kw))) return 'clothes';
  if (ELECTRONICS_KEYWORDS.some((kw) => lower.includes(kw))) return 'electronics';
  return 'general';
}

function normalizeText(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function scoreRelevance(candidateTitle, query) {
  const qTokens = normalizeText(query)
    .split(' ')
    .filter((t) => t.length >= 2 && !/^\d+(g|kg|ml|l|gb|tb|eu)$/.test(t));
  const tNorm = normalizeText(candidateTitle);
  if (qTokens.length === 0 || !tNorm) return 0;

  let matched = 0;
  for (const tok of qTokens) {
    if (tNorm.includes(tok)) matched++;
  }
  return matched / qTokens.length;
}

function decodeHtmlEntities(str) {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function isSafePublicUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' || host === '127.0.0.1' || host === '::1' ||
      host.startsWith('10.') || host.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.endsWith('.local')
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractSlugFromUrl(parsedUrl) {
  const segments = parsedUrl.pathname
    .split('/')
    .filter((s) => s && !['pd', 'p', 'produs', 'product', 'ro', 'cautare', 'search'].includes(s.toLowerCase()));
  const longest = segments.sort((a, b) => b.length - a.length)[0] || parsedUrl.hostname;
  return longest
    .replace(/\.html?$/i, '')
    .replace(/-[a-z0-9]{6,}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function extractMetadataFromHtml(html, parsedUrl) {
  const result = { title: '', image: '', price: null, currency: 'RON', brand: '', scrapedLive: true };

  const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of ldMatches) {
    try {
      const json = JSON.parse(match[1].trim());
      const items = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];
      for (const item of items) {
        if (item && (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product')))) {
          if (item.name && !result.title) result.title = decodeHtmlEntities(item.name);
          if (item.brand) result.brand = typeof item.brand === 'string' ? item.brand : item.brand.name || '';
          if (item.image && !result.image) result.image = Array.isArray(item.image) ? item.image[0] : (item.image.url || item.image);
          const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
          if (offers && offers.price && !result.price) {
            const p = parseFloat(String(offers.price).replace(',', '.'));
            if (!Number.isNaN(p) && p > 0) result.price = p;
          }
        }
      }
    } catch { /* ignore */ }
  }

  if (!result.title) {
    const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (ogTitle) result.title = decodeHtmlEntities(ogTitle[1]);
  }
  if (!result.title) {
    const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleTag) {
      result.title = decodeHtmlEntities(titleTag[1])
        .replace(/\s*[-|–]\s*(eMAG\.ro|Altex|Fashion Days|Answear|epantofi|About You|Zalando|GymBeam).*$/i, '')
        .trim();
    }
  }
  if (!result.image) {
    const ogImg = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
    if (ogImg) result.image = ogImg[1];
  }
  if (!result.price) {
    const ogPrice = html.match(/<meta[^>]+property=["'](?:product:price:amount|og:price:amount)["'][^>]+content=["']([^"']+)["']/i);
    if (ogPrice) {
      const p = parseFloat(ogPrice[1].replace(',', '.'));
      if (!Number.isNaN(p) && p > 0) result.price = p;
    }
  }
  if (!result.title) {
    result.title = extractSlugFromUrl(parsedUrl);
    result.scrapedLive = false;
  }
  return result;
}

/**
 * Inspect a product page for size stock if category is shoes/clothes.
 */
async function checkSizeStockOnPage(productUrl, category, desiredSize) {
  if (category !== 'shoes' && category !== 'clothes') {
    return { requiresSize: false, status: 'in_stock', label: 'În stoc', availableSizes: [], hasDesiredSize: true };
  }
  const target = (desiredSize || '').trim().toUpperCase();
  if (!target) {
    return { requiresSize: true, status: 'select_size', label: 'Selectează mărimea', availableSizes: [], hasDesiredSize: true };
  }

  // Quick check if the URL or title itself already specifies the size (common on eMAG)
  const urlSizeMatch = productUrl.match(/marime-(\d{2}|xs|s|m|l|xl|xxl)\b/i);
  if (urlSizeMatch) {
    const foundSize = urlSizeMatch[1].toUpperCase();
    return foundSize === target
      ? { requiresSize: true, status: 'in_stock', label: `În stoc (${target})`, availableSizes: [foundSize], hasDesiredSize: true }
      : { requiresSize: true, status: 'out_of_stock', label: `Doar mărimea ${foundSize}`, availableSizes: [foundSize], hasDesiredSize: false };
  }

  try {
    const r = await fetch(productUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(3500) });
    if (r.ok) {
      const html = await r.text();
      // Check JSON-LD or size attributes
      const sizeTokens = category === 'shoes'
        ? ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46']
        : ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
      const found = sizeTokens.filter((sz) =>
        new RegExp(`(?:"size"\\s*:\\s*"${sz}"|data-size=["']${sz}["']|>${sz}<)`, 'i').test(html)
      );
      if (found.length > 0) {
        const has = found.includes(target);
        return {
          requiresSize: true,
          status: has ? 'in_stock' : 'out_of_stock',
          label: has ? `În stoc (${target})` : `Epuizat mărimea ${target}`,
          availableSizes: found,
          hasDesiredSize: has,
        };
      }
    }
  } catch { /* ignore timeout */ }

  return {
    requiresSize: true,
    status: 'select_size',
    label: `Verifică mărimea ${target} pe site`,
    availableSizes: [],
    hasDesiredSize: true,
  };
}

// --- LIVE STORE SCRAPERS ---

async function searchEmagLive(query) {
  const url = `https://www.emag.ro/search/${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(5000) });
  if (!r.ok) return [];
  const html = await r.text();
  const cards = html.split('class="card-item ').slice(1, 14);
  const results = [];

  for (const card of cards) {
    const title = decodeHtmlEntities(
      (card.match(/data-name="([^"]+)"/) || card.match(/class="card-v2-title[^"]*"[^>]*>([^<]+)/))?.[1] || ''
    );
    const href = (card.match(/href="(https:\/\/www\.emag\.ro\/[^"]+\/pd\/[^"]+)"/))?.[1];
    const priceM = card.match(/class="product-new-price">([\d.]+)<sup[^>]*>(?:<small[^>]*>[^<]*<\/small>)?(\d{2})<\/sup>/i);
    const price = priceM ? parseFloat(`${priceM[1].replace(/\./g, '')}.${priceM[2]}`) : null;

    if (title && href && price && scoreRelevance(title, query) >= 0.45) {
      results.push({ storeId: 'emag', title, url: href, price, inStock: !/stoc epuizat/i.test(card) });
    }
  }
  return results.slice(0, 3);
}

async function searchAltexLive(query) {
  const url = `https://fenrir.altex.ro/v2/catalog/search/${encodeURIComponent(query)}?size=8`;
  const r = await fetch(url, {
    headers: { ...FETCH_HEADERS, 'Origin': 'https://altex.ro', 'Referer': 'https://altex.ro/' },
    signal: AbortSignal.timeout(4500),
  });
  if (!r.ok) return [];
  const data = await r.json();
  const products = data?.products || [];
  return products
    .filter((p) => p?.name && p?.price && scoreRelevance(p.name, query) >= 0.45)
    .slice(0, 3)
    .map((p) => ({
      storeId: 'altex',
      title: p.name,
      url: p.url_key ? `https://altex.ro/${p.url_key}/cpd/${p.sku}/` : `https://altex.ro/cauta/?q=${encodeURIComponent(query)}`,
      price: Number(p.price),
      inStock: p.is_in_stock !== false,
    }));
}

async function searchGymbeamLive(query) {
  const cleanQ = query.replace(/\b\d+\s*(g|kg|ml|l)\b/gi, '').replace(/\s+/g, ' ').trim();
  const queriesToTry = cleanQ && cleanQ !== query ? [query, cleanQ] : [query];

  for (const qText of queriesToTry) {
    const gql = `{products(search:${JSON.stringify(qText)},pageSize:5){items{name url_key stock_status price_range{minimum_price{final_price{value}}}}}}`;
    const r = await fetch(`https://gymbeam.ro/graphql?query=${encodeURIComponent(gql)}`, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(4500),
    });
    if (!r.ok) continue;
    const json = await r.json();
    const items = json?.data?.products?.items || [];
    const matched = items
      .filter((it) => it?.name && it?.price_range?.minimum_price?.final_price?.value && scoreRelevance(it.name, query) >= 0.45)
      .slice(0, 3);

    if (matched.length > 0) {
      return await Promise.all(matched.map(async (it) => {
        const prodUrl = `https://gymbeam.ro/${it.url_key}.html`;
        let realPrice = Number(it.price_range.minimum_price.final_price.value);
        try {
          const pr = await fetch(prodUrl, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(3500) });
          if (pr.ok) {
            const ph = await pr.text();
            const jp = ph.match(/"(?:final_price|price|amount)"\s*:\s*([\d.]+)/i);
            if (jp && parseFloat(jp[1]) > 0) realPrice = parseFloat(jp[1]);
          }
        } catch { /* keep graphql price */ }
        return {
          storeId: 'gymbeam',
          title: it.name,
          url: prodUrl,
          price: realPrice,
          inStock: it.stock_status !== 'OUT_OF_STOCK',
        };
      }));
    }
  }
  return [];
}

async function searchFashionDaysLive(query) {
  const url = `https://www.fashiondays.ro/search/?q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(4500) });
  if (!r.ok) return [];
  const html = await r.text();
  const cards = html.split('campaign-card').slice(1, 10);
  const results = [];
  for (const c of cards) {
    const href = c.match(/href="(https:\/\/www\.fashiondays\.ro\/p\/[^"]+)"/i)?.[1];
    const title = decodeHtmlEntities(c.match(/title="([^"]+)"/i)?.[1] || c.match(/product-card-name[^>]*>([^<]+)/i)?.[1] || '');
    const priceM = c.match(/(\d{2,4})[,.](\d{2})\s*lei/i) || c.match(/data-price="([\d.]+)"/i);
    const price = priceM ? parseFloat(priceM[2] ? `${priceM[1]}.${priceM[2]}` : priceM[1]) : null;
    if (title && href && price && scoreRelevance(title, query) >= 0.45) {
      results.push({ storeId: 'fashiondays', title, url: href, price, inStock: true });
    }
  }
  return results.slice(0, 2);
}

async function searchZalandoLive(query) {
  const url = `https://www.zalando.ro/catalog/?q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(4500) });
  if (!r.ok) return [];
  const html = await r.text();
  const results = [];
  // Zalando embeds product links ending in .html with nearby price in lei
  const articles = html.split('<article').slice(1, 12);
  for (const art of articles) {
    const href = art.match(/href="(https:\/\/www\.zalando\.ro\/[^"]+\.html)"/i)?.[1];
    const alt = decodeHtmlEntities(art.match(/alt="([^"]+)"/i)?.[1] || '');
    const priceM = art.match(/(\d{2,4})[,.](\d{2})\s*lei/i);
    if (href && alt && priceM && scoreRelevance(alt, query) >= 0.5) {
      results.push({
        storeId: 'zalando',
        title: alt,
        url: href,
        price: parseFloat(`${priceM[1]}.${priceM[2]}`),
        inStock: true,
      });
    }
  }
  return results.slice(0, 2);
}

async function extractPriceFromUrlQuick(url) {
  try {
    const r = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return null;
    const html = await r.text();
    const meta = extractMetadataFromHtml(html, new URL(url));
    if (meta.price && meta.price > 0) return meta.price;
    const jp = html.match(/"(?:final_price|price|amount)"\s*:\s*"?([\d.]+)"?/i);
    if (jp && parseFloat(jp[1]) > 5) return parseFloat(jp[1]);
    const txtP = html.match(/(\d{2,5})[,.](\d{2})\s*(?:lei|ron)\b/i);
    if (txtP) return parseFloat(`${txtP[1]}.${txtP[2]}`);
  } catch { /* ignore */ }
  return null;
}

async function searchSerperShoppingRo(query, serperKey) {
  const info = { used: false, shoppingCount: 0, webCount: 0, error: null };
  if (!serperKey) return { matches: [], info };
  info.used = true;

  const headers = { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' };
  const matches = [];

  try {
    const [shopRes, webRes] = await Promise.allSettled([
      fetch('https://google.serper.dev/shopping', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q: query, gl: 'ro', hl: 'ro', num: 20 }),
        signal: AbortSignal.timeout(5500),
      }),
      fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({ q: `${query} pret`, gl: 'ro', hl: 'ro', num: 15 }),
        signal: AbortSignal.timeout(5500),
      }),
    ]);

    // 1. Process Google Shopping RO
    if (shopRes.status === 'fulfilled') {
      if (!shopRes.value.ok) {
        info.error = `Serper HTTP ${shopRes.value.status}`;
      } else {
        const data = await shopRes.value.json();
        const shopping = data?.shopping || [];
        for (const item of shopping) {
          const priceNum = parseFloat(String(item.price || '').replace(/[^\d.,]/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.'));
          if (!item.title || !item.link || Number.isNaN(priceNum) || priceNum <= 0) continue;
          if (scoreRelevance(item.title, query) < 0.3) continue;
          info.shoppingCount++;
          matches.push({
            storeId: null,
            customStoreName: item.source || 'Magazin RO',
            title: item.title,
            url: item.link,
            price: priceNum,
            inStock: true,
          });
        }
      }
    }

    // 2. Process Google Web Search RO (discovers Trendyol, Dr.Max, Notino, niche .ro shops)
    if (webRes.status === 'fulfilled' && webRes.value.ok) {
      const wData = await webRes.value.json();
      const organic = (wData?.organic || []).slice(0, 12);
      const seenDomains = new Set(matches.map((m) => { try { return new URL(m.url).hostname; } catch { return ''; } }));

      const webCandidates = organic.filter((o) => {
        if (!o?.link || !o?.title) return false;
        try {
          const host = new URL(o.link).hostname.replace(/^www\./, '');
          if (seenDomains.has(host) || seenDomains.has(`www.${host}`)) return false;
          if (/youtube\.|facebook\.|instagram\.|tiktok\.|wikipedia\.|reddit\./i.test(host)) return false;
          return scoreRelevance(`${o.title} ${o.snippet || ''}`, query) >= 0.4;
        } catch { return false; }
      }).slice(0, 8);

      const enrichedWeb = await Promise.all(webCandidates.map(async (o) => {
        let price = null;
        if (o.priceRange) {
          const m = String(o.priceRange).match(/([\d.,]+)/);
          if (m) price = parseFloat(m[1].replace(/\.(?=\d{3})/g, '').replace(',', '.'));
        }
        if (!price && o.snippet) {
          const m = o.snippet.match(/(\d{2,5})[,.](\d{2})\s*(?:lei|ron)/i);
          if (m) price = parseFloat(`${m[1]}.${m[2]}`);
        }
        if (!price) {
          price = await extractPriceFromUrlQuick(o.link);
        }
        if (!price || Number.isNaN(price) || price <= 0) return null;
        info.webCount++;
        const host = new URL(o.link).hostname.replace(/^www\./, '');
        return {
          storeId: null,
          customStoreName: host,
          title: o.title,
          url: o.link,
          price,
          inStock: true,
        };
      }));

      for (const item of enrichedWeb) {
        if (item) matches.push(item);
      }
    }
  } catch (err) {
    info.error = err.message;
  }

  return { matches: matches.slice(0, 20), info };
}

function calculateStoreCosts(store, productPrice, options) {
  const {
    deliveryType = 'easybox',
    paymentMethod = 'card',
    geniusEmag = false,
    geniusFashion = false,
    voucherPercent = 0,
  } = options;

  const discountedPrice = Number((productPrice * (1 - Math.min(Math.max(voucherPercent, 0), 50) / 100)).toFixed(2));

  let shippingFee = deliveryType === 'easybox' ? store.shipping.easyboxFee : store.shipping.baseFee;
  let shippingReason = deliveryType === 'easybox' ? 'Livrare locker / easybox' : 'Curier la ușă';

  if (store.shipping.freeThreshold === 0) {
    shippingFee = 0;
    shippingReason = 'Transport gratuit standard';
  } else if (discountedPrice >= store.shipping.freeThreshold) {
    shippingFee = 0;
    shippingReason = `Gratuit (peste ${store.shipping.freeThreshold} lei)`;
  } else if (store.shipping.geniusFree === 'emag' && geniusEmag) {
    shippingFee = 0;
    shippingReason = 'Gratuit cu eMAG Genius';
  } else if (store.shipping.geniusFree === 'fashion' && geniusFashion) {
    shippingFee = 0;
    shippingReason = 'Gratuit cu Genius';
  }

  const rambursFee = paymentMethod === 'ramburs' ? store.shipping.rambursFee : 0;
  const totalCost = Number((discountedPrice + shippingFee + rambursFee).toFixed(2));

  return {
    originalPrice: productPrice,
    discountedPrice,
    shippingFee,
    shippingReason,
    rambursFee,
    totalCost,
  };
}

async function handleAnalyzeUrl(req, res) {
  try {
    const body = await readJsonBody(req);
    const parsedUrl = isSafePublicUrl(body.url);
    if (!parsedUrl) {
      return sendJson(res, 400, { error: 'Link invalid. Te rog introdu un URL valid care începe cu https:// sau http://.' });
    }

    let metadata = {
      title: extractSlugFromUrl(parsedUrl),
      image: '',
      price: null,
      currency: 'RON',
      brand: '',
      scrapedLive: false,
      domain: parsedUrl.hostname.replace(/^www\./, ''),
    };

    try {
      const response = await fetch(parsedUrl.toString(), {
        headers: FETCH_HEADERS,
        signal: AbortSignal.timeout(4500),
      });
      if (response.ok) {
        const html = await response.text();
        metadata = { ...metadata, ...extractMetadataFromHtml(html, parsedUrl) };
      }
    } catch { /* fallback to slug */ }

    const category = detectCategory(`${metadata.title} ${parsedUrl.hostname}`);
    sendJson(res, 200, { ...metadata, detectedCategory: category });
  } catch {
    sendJson(res, 500, { error: 'Nu am putut analiza link-ul.' });
  }
}

async function handleSearch(req, res) {
  try {
    const body = await readJsonBody(req);
    const query = (body.query || '').trim();
    if (!query || query.length < 2) {
      return sendJson(res, 400, { error: 'Introdu numele produsului (minim 2 caractere).' });
    }

    const category = body.category && body.category !== 'auto'
      ? body.category
      : detectCategory(query);
    const desiredSize = (body.size || '').trim();

    // Run live Romanian store searches in parallel (+ Google Shopping RO via Serper if key provided)
    const scrapers = [
      searchEmagLive(query),
      searchAltexLive(query),
      searchGymbeamLive(query),
    ];
    if (category === 'shoes' || category === 'clothes' || category === 'general') {
      scrapers.push(searchFashionDaysLive(query), searchZalandoLive(query));
    }

    const [settled, serperResult] = await Promise.all([
      Promise.allSettled(scrapers),
      searchSerperShoppingRo(query, body.serperKey),
    ]);

    const rawMatches = [
      ...settled.filter((s) => s.status === 'fulfilled').flatMap((s) => s.value),
      ...(serperResult.matches || []),
    ];

    // Deduplicate by normalized URL
    const seenUrls = new Set();
    const liveMatches = rawMatches.filter((m) => {
      const key = (m.url || '').split('?')[0].toLowerCase();
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    });

    // Enrich each live match with shipping, ramburs, and real size check (for shoes/clothes)
    const DEFAULT_RO_STORE = {
      id: 'external',
      name: 'Magazin RO',
      domain: 'ro',
      shipping: { baseFee: 19.9, easyboxFee: 14.9, freeThreshold: 250, geniusFree: null, rambursFee: 5.0, deliveryDays: '2-4 zile' },
    };

    const offers = await Promise.all(
      liveMatches.map(async (match) => {
        let store = match.storeId ? ROMANIAN_STORES.find((s) => s.id === match.storeId) : null;
        if (!store && match.customStoreName) {
          const lowerName = match.customStoreName.toLowerCase();
          store = ROMANIAN_STORES.find((s) => lowerName.includes(s.name.toLowerCase()) || lowerName.includes(s.domain.split('.')[0]));
        }
        const resolvedStore = store || {
          ...DEFAULT_RO_STORE,
          id: `ext_${normalizeText(match.customStoreName || 'ro').replace(/\s+/g, '_')}`,
          name: match.customStoreName || 'Magazin RO',
          domain: (() => { try { return new URL(match.url).hostname.replace(/^www\./, ''); } catch { return 'ro'; } })(),
        };

        const costs = calculateStoreCosts(resolvedStore, match.price, body);
        const stock = match.inStock === false
          ? { requiresSize: false, status: 'out_of_stock', label: 'Stoc epuizat', availableSizes: [], hasDesiredSize: false }
          : await checkSizeStockOnPage(match.url, category, desiredSize);

        return {
          storeId: resolvedStore.id,
          storeName: resolvedStore.name,
          domain: resolvedStore.domain,
          productTitle: match.title,
          verifiedLive: true,
          deliveryDays: resolvedStore.shipping.deliveryDays,
          freeThreshold: resolvedStore.shipping.freeThreshold,
          url: match.url,
          ...costs,
          stock,
        };
      })
    );

    offers.sort((a, b) => a.totalCost - b.totalCost);

    const matchedStoreIds = new Set(offers.map((o) => o.storeId));
    const manualStores = ROMANIAN_STORES
      .filter((store) => {
        if (matchedStoreIds.has(store.id)) return false;
        if (category === 'general') return true;
        return store.categories.includes(category) || store.categories.includes('general');
      })
      .map((store) => ({
        storeId: store.id,
        storeName: store.name,
        domain: store.domain,
        deliveryDays: store.shipping.deliveryDays,
        freeThreshold: store.shipping.freeThreshold,
        baseShipping: body.deliveryType === 'courier' ? store.shipping.baseFee : store.shipping.easyboxFee,
        rambursFee: body.paymentMethod === 'ramburs' ? store.shipping.rambursFee : 0,
        url: store.searchUrl(query),
      }));

    const inStockOffers = offers.filter((o) => o.stock.hasDesiredSize);
    const bestDeal = inStockOffers[0] || offers[0] || null;
    const highestOffer = offers[offers.length - 1] || null;
    const maxSavings = bestDeal && highestOffer && offers.length > 1
      ? Number((highestOffer.totalCost - bestDeal.totalCost).toFixed(2))
      : 0;

    sendJson(res, 200, {
      query,
      detectedCategory: category,
      desiredSize,
      totalStoresChecked: offers.length,
      inStockCount: inStockOffers.length,
      bestDealStoreId: bestDeal ? bestDeal.storeId : null,
      bestDealUrl: bestDeal ? bestDeal.url : null,
      maxSavings,
      serperInfo: serperResult.info,
      offers,
      manualStores,
    });
  } catch {
    sendJson(res, 500, { error: 'Eroare la căutarea ofertelor.' });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  const safePath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, safePath));
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(fullPath, (err, content) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && reqUrl.pathname === '/api/analyze-url') return handleAnalyzeUrl(req, res);
  if (req.method === 'POST' && reqUrl.pathname === '/api/search') return handleSearch(req, res);
  if (req.method === 'GET' && reqUrl.pathname === '/api/stores') {
    return sendJson(res, 200, { stores: ROMANIAN_STORES.map(({ id, name, domain, categories }) => ({ id, name, domain, categories })) });
  }
  if (req.method === 'GET') return serveStatic(req, res, reqUrl.pathname);
  res.writeHead(405);
  res.end('Method Not Allowed');
});

server.listen(PORT, () => {
  console.log(`FrugalRadar ruleaza la http://localhost:${PORT}`);
});
