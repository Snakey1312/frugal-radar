'use strict';

const os = require('node:os');
const path = require('node:path');

// Offline, keyless product hint from visible text in a photo. This runs on
// Node/Vercel too (unlike the old Python helper), so photo search keeps working
// without a Gemini API key after deployment.
const { createWorker } = require('tesseract.js');

function normalize(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTerm(text, term) {
  const t = normalize(term);
  return Boolean(t) && new RegExp(`(?:^|\\s)${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`).test(text);
}

const BRANDS = [
  ['the north face', 'The North Face'], ['new balance', 'New Balance'],
  ['under armour', 'Under Armour'], ['la roche posay', 'La Roche Posay'],
  ['optimum nutrition', 'Optimum Nutrition'], ['the ordinary', 'The Ordinary'],
  ['tommy hilfiger', 'Tommy Hilfiger'], ['calvin klein', 'Calvin Klein'],
  ['ralph lauren', 'Ralph Lauren'], ['gym beam', 'GymBeam'],
  ['my protein', 'Myprotein'], ['bio tech usa', 'BiotechUSA'],
  ['apple', 'Apple'], ['samsung', 'Samsung'], ['xiaomi', 'Xiaomi'],
  ['huawei', 'Huawei'], ['lenovo', 'Lenovo'], ['asus', 'Asus'],
  ['dell', 'Dell'], ['sony', 'Sony'], ['philips', 'Philips'],
  ['bosch', 'Bosch'], ['nike', 'Nike'], ['adidas', 'Adidas'],
  ['puma', 'Puma'], ['reebok', 'Reebok'], ['asics', 'Asics'],
  ['salomon', 'Salomon'], ['jordan', 'Jordan'], ['converse', 'Converse'],
  ['vans', 'Vans'], ['fila', 'Fila'], ['hoka', 'Hoka'],
  ['skechers', 'Skechers'], ['timberland', 'Timberland'],
];

const MODELS = [
  [/air\s*max\s*plus\s*tn|air\s*max\s*tn|nike\s*tn|tuned\s*air|air\s*max\s*plus/, 'Air Max Plus TN', 'shoes'],
  [/air\s*force\s*(?:1|one)|af\s*1|af1/, 'Air Force 1', 'shoes'],
  [/air\s*max\s*97/, 'Air Max 97', 'shoes'],
  [/air\s*max\s*95/, 'Air Max 95', 'shoes'],
  [/air\s*max\s*90/, 'Air Max 90', 'shoes'],
  [/air\s*max\s*270/, 'Air Max 270', 'shoes'],
  [/air\s*max\s*1\b/, 'Air Max 1', 'shoes'],
  [/gel\s*kayano\s*(\d+)?/, 'GEL-KAYANO', 'shoes'],
  [/ultra\s*boost/, 'Ultraboost', 'shoes'],
  [/samba(?:\s*og)?/, 'Samba OG', 'shoes'],
  [/dunk\s*low/, 'Dunk Low', 'shoes'],
  [/yeezy\s*boost/, 'Yeezy Boost', 'shoes'],
  [/jordan\s*(\d+)/, 'Air Jordan', 'shoes'],
  [/iphone\s*(\d+(?:\s*(?:pro\s*max|pro|plus|mini))?)/, 'iPhone', 'electronics'],
  [/galaxy\s*s\s*(\d+)/, 'Galaxy S', 'electronics'],
  [/macbook\s*(air|pro)?/, 'MacBook', 'electronics'],
  [/watch\s*series\s*(\d+)/, 'Apple Watch Series', 'electronics'],
  [/creatina\s*monohidrata/, 'Creatina Monohidrata', 'supplements'],
  [/proteina\s*(?:din\s*zer|whey)?/, 'Proteina Whey', 'supplements'],
];

const CATEGORY_KEYWORDS = {
  shoes: ['pantofi', 'adidasi', 'sneakers', 'tenisi', 'incaltaminte', 'ghete', 'cizme', 'air max', 'air force'],
  clothes: ['tricou', 'hanorac', 'geaca', 'pantaloni', 'blugi', 'rochie', 'jacheta', 'hoodie'],
  electronics: ['telefon', 'laptop', 'monitor', 'televizor', 'casti', 'iphone', 'samsung', 'playstation', 'xbox'],
  supplements: ['proteina', 'creatina', 'supliment', 'capsule', 'pastile', 'whey'],
  pharmacy_beauty: ['crema', 'serum', 'sampon', 'parfum', 'ruj', 'lotiune'],
  diy_home: ['burghiu', 'masina', 'scule', 'mobila', 'aspirator'],
  books: ['carte', 'roman', 'editura', 'isbn'],
};

const COLOR_GROUPS = {
  black: ['triple black', 'triplu negru', 'black', 'negru', 'neagra', 'negri', 'negre'],
  white: ['white', 'alb', 'alba', 'albi', 'albe'],
  red: ['red', 'rosu', 'rosie', 'rosii'],
  blue: ['navy blue', 'navy', 'blue', 'albastru', 'albastra', 'albastri', 'albastre'],
  grey: ['wolf grey', 'dark grey', 'grey', 'gray', 'gri'],
  green: ['green', 'verde', 'verzi'],
  yellow: ['yellow', 'galben', 'galbena', 'galbeni', 'galbene'],
  brown: ['brown', 'maro'],
  beige: ['beige', 'bej'],
  pink: ['pink', 'roz', 'rozaliu'],
  purple: ['purple', 'violet', 'mov'],
  silver: ['silver', 'argintiu', 'argintie'],
  gold: ['gold', 'auriu', 'aurie'],
  orange: ['orange', 'portocaliu', 'portocalie'],
};

const NOISE_WORDS = new Set([
  'lei', 'ron', 'gratuit', 'cumpara', 'cumparare', 'stoc', 'disponibil',
  'disponibile', 'moda', 'frumusete', 'site', 'verifica', 'pret', 'total',
  'transport', 'ramburs', 'categorie', 'oferta', 'oferte', 'produs',
]);

function findBrand(text) {
  for (const [term, label] of BRANDS) if (hasTerm(text, term)) return label;
  return '';
}

function findModel(text) {
  for (const [pattern, label, category] of MODELS) {
    const match = text.match(pattern);
    if (match) {
      const suffix = match[1] ? ` ${match[1].trim()}` : '';
      return { model: `${label}${suffix}`.replace(/\s+/g, ' ').trim(), category };
    }
  }
  return { model: '', category: '' };
}

function detectCategory(text, modelCategory) {
  if (modelCategory) return modelCategory;
  for (const [category, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => hasTerm(text, w))) return category;
  }
  return 'general';
}

function detectColor(text) {
  for (const [color, words] of Object.entries(COLOR_GROUPS)) {
    if (words.some((w) => hasTerm(text, w))) return color;
  }
  return '';
}

function findSize(text) {
  for (const re of [
    /(?:marimea|marime|size)\s*:?\s*(\d{2}(?:\.\d)?)/,
    /\b(\d{2}(?:\.\d)?)\s*eu\b/,
  ]) {
    const match = text.match(re);
    if (match) {
      const size = match[1];
      const n = Number(size);
      if (n >= 35 && n <= 50) return size;
    }
  }
  return '';
}

function findCapacity(text, category) {
  if (!['electronics', 'supplements'].includes(category)) return '';
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*(gb|tb|kg|g|ml|l)\b/);
  return match ? `${match[1]}${match[2]}` : '';
}

// Screenshots often contain the searched query verbatim near the top. Prefer it
// over product titles from the results table.
function extractExplicitQuery(lines) {
  const joined = lines.join(' ');
  const patterns = [
    /oferte\s+\w+\s+gasite\s+pentru\s*[,."'\u201e\u201d]*\s*([a-z0-9 .-]{4,70})/i,
    /cautare\s*[,:"']*\s*([a-z0-9 .-]{4,70})/i,
  ];
  for (const re of patterns) {
    const match = joined.match(re);
    if (!match) continue;
    const candidate = normalize(match[1]).split(' ').slice(0, 8).join(' ');
    if (candidate.split(' ').length >= 2 && !candidate.includes('localhost')) return candidate;
  }
  return '';
}

function buildResult(lines) {
  const text = normalize(lines.join(' '));
  if (!text) return null;

  const brand = findBrand(text);
  const found = findModel(text);
  const category = detectCategory(text, found.category);
  const color = detectColor(text);
  const size = findSize(text);
  const capacity = findCapacity(text, category);

  let query = extractExplicitQuery(lines);
  if (!query) {
    const parts = [brand, found.model];
    if (!found.model && category === 'shoes') parts.push('sneakers');
    parts.push(color, capacity);
    query = parts.filter(Boolean).join(' ');
  }

  if (!query) {
    const fallback = lines
      .map((line) => normalize(line))
      .filter((line) => line.split(' ').filter((w) => w && !NOISE_WORDS.has(w) && w.length > 1).length >= 3)
      .sort((a, b) => b.length - a.length)[0];
    query = fallback ? fallback.split(' ').slice(0, 8).join(' ') : text.split(' ').slice(0, 8).join(' ');
  }

  const confidence = brand && found.model ? 0.92 : brand || found.model ? 0.62 : 0.28;
  return {
    query: query.slice(0, 160),
    category,
    size,
    brand,
    model: found.model,
    color,
    confidence,
    ocrLines: lines.slice(0, 10),
  };
}

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      cachePath: process.env.TESSDATA_CACHE || path.join(os.tmpdir(), 'frugalradar-tessdata'),
      logger: () => {},
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function identifyImageLocally(base64, _mimeType) {
  let worker;
  try {
    worker = await getWorker();
    const image = Buffer.isBuffer(base64) ? base64 : Buffer.from(String(base64 || ''), 'base64');
    const { data } = await worker.recognize(image);
    const lines = String(data?.text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return buildResult(lines);
  } catch {
    return null;
  } finally {
    // Keep the worker warm for subsequent requests, but never leak more than one.
    if (worker && process.env.VERCEL) {
      await worker.terminate().catch(() => {});
      workerPromise = null;
    }
  }
}

module.exports = { identifyImageLocally, buildResult, normalize };
