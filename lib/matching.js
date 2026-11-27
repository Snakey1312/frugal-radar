'use strict';

const CATEGORY_EXPLICIT_KEYWORDS = {
  shoes: [
    'adidasi', 'pantofi', 'pantofi sport', 'ghete', 'cizme', 'bocanci', 'sandale',
    'tenisi', 'mocasini', 'sneakers', 'slapi', 'papuci', 'espadrile', 'balerini',
    'incaltaminte', 'air force', 'air max', 'dunk', 'yeezy', 'ultraboost',
    'gel kayano', 'stan smith', 'superstar', 'chuck taylor', 'old skool',
    'samba', 'gazelle', 'pegasus', 'vomero', 'nimbus', 'hoka', 'skechers',
    'timberland', 'converse', 'vans', 'epantofi', 'sizeer', 'footshop',
  ],
  clothes: [
    'tricou', 'tricouri', 'hanorac', 'hanorace', 'geaca', 'geci', 'jacheta',
    'pantaloni', 'blugi', 'jeans', 'rochie', 'rochii', 'fusta', 'pulover',
    'cardigan', 'sacou', 'palton', 'camasa', 'camasi', 'trening', 'costum',
    'vesta', 'shorts', 'sort', 'colanti', 'leggings', 'pijama', 'lenjerie',
    'sosete', 'boxeri', 'hoodie', 'sweatshirt', 't shirt', 'tshirt', 'jacket',
    'coat', 'parka', 'nuptse', 'fleece', 'polar', 'imbracaminte', 'haine',
    'zara', 'mango', 'levis',
  ],
  electronics: [
    'telefon', 'smartphone', 'iphone', 'galaxy', 'xiaomi', 'redmi', 'poco',
    'pixel', 'oneplus', 'laptop', 'macbook', 'notebook', 'ultrabook', 'lenovo',
    'thinkpad', 'ideapad', 'asus', 'rog', 'zenbook', 'dell', 'acer', 'msi',
    'monitor', 'televizor', 'tv', 'oled', 'qled', 'casti', 'headphones',
    'earbuds', 'airpods', 'galaxy buds', 'boxa', 'soundbar', 'playstation',
    'ps5', 'ps4', 'xbox', 'nintendo', 'switch', 'placa video', 'rtx', 'gtx',
    'radeon', 'ssd', 'nvme', 'hdd', 'procesor', 'ryzen', 'intel', 'ram',
    'ddr4', 'ddr5', 'placa de baza', 'sursa pc', 'tastatura', 'mouse',
    'webcam', 'imprimanta', 'router', 'tableta', 'ipad', 'smartwatch',
    'apple watch', 'garmin', 'aspirator', 'dyson', 'roborock', 'espressor',
    'delonghi', 'frigider', 'masina de spalat', 'cuptor', 'air fryer',
    'camera foto', 'gopro', 'consola', 'gpu', 'cpu',
  ],
  supplements: [
    'proteina', 'proteine', 'protein', 'whey', 'izolat', 'isolate', 'creatina',
    'creatine', 'creapure', 'pre workout', 'preworkout', 'bcaa', 'eaa',
    'aminoacizi', 'amino', 'glutamina', 'citrulina', 'beta alanina',
    'vitamina', 'vitamine', 'multivitamine', 'magneziu', 'zinc', 'omega',
    'omega 3', 'colagen', 'collagen', 'electroliti', 'gainer', 'mass gainer',
    'carnitina', 'melatonina', 'ashwagandha', 'probiotic', 'probiotice',
    'supliment', 'suplimente', 'baton proteic', 'gymbeam', 'myprotein',
    'optimum nutrition', 'gold standard', 'biotech', 'scitec', 'veinz',
  ],
  pharmacy_beauty: [
    'crema', 'serum', 'ser', 'gel de dus', 'sampon', 'balsam', 'masca par',
    'lotiune', 'demachiant', 'apa micelara', 'spf', 'protectie solara',
    'parfum', 'apa de parfum', 'apa de toaleta', 'edp', 'edt', 'deodorant',
    'antiperspirant', 'ruj', 'rimel', 'mascara', 'fond de ten', 'pudra',
    'corector', 'fard', 'paleta', 'lac de unghii', 'pasta de dinti',
    'periuta', 'irigator', 'scutece', 'pampers', 'lapte praf', 'biberon',
    'tensiometru', 'termometru', 'plasturi', 'unguent', 'sirop', 'pastile',
    'comprimate', 'farmacie', 'dermatocosmetice', 'cerave', 'la roche posay',
    'vichy', 'bioderma', 'avene', 'eucerin', 'the ordinary', 'notino',
    'sephora', 'drmax', 'farmacia tei', 'bebetei',
  ],
  diy_home: [
    'bormasina', 'masina de gaurit', 'insurubat', 'polizor', 'flex',
    'fierastrau', 'drujba', 'ciocan', 'rotopercutor', 'surubelnita',
    'cheie', 'trusa scule', 'scule', 'scara', 'vopsea', 'lavabila',
    'amorsa', 'adeziv', 'silicon', 'ciment', 'gips', 'rigips', 'gresie',
    'faianta', 'parchet', 'baterie chiuveta', 'chiuveta', 'robinet',
    'lavoar', 'vas wc', 'cabina dus', 'corp iluminat', 'bec', 'lustra',
    'plafoniera', 'saltea', 'lenjerie pat', 'perna', 'pilota', 'dulap',
    'birou', 'scaun birou', 'canapea', 'masa', 'raft', 'etajera', 'comoda',
    'dedeman', 'hornbach', 'ikea', 'makita', 'dewalt', 'milwaukee',
    'einhell', 'karcher',
  ],
  books: [
    'carte', 'carti', 'roman', 'romane', 'volum', 'editura', 'autor',
    'manual', 'dictionar', 'ghid', 'atlas', 'benzi desenate', 'manga',
    'audiobook', 'ebook', 'carturesti', 'humanitas', 'nemira', 'polirom',
    'litera', 'curtea veche', 'corint', 'isbn', 'coperta', 'brosata',
    'cartonata', 'paperback', 'hardcover',
  ],
};

// Multi-category brands receive low weight so explicit product nouns always win.
const MULTI_CATEGORY_BRAND_HINTS = {
  shoes: ['nike', 'adidas', 'puma', 'reebok', 'new balance', 'asics', 'salomon', 'jordan', 'under armour', 'fila'],
  clothes: ['tommy hilfiger', 'calvin klein', 'ralph lauren', 'north face', 'columbia', 'lacoste', 'guess'],
  electronics: ['apple', 'samsung', 'sony', 'philips', 'bosch', 'hp', 'lg', 'panasonic'],
  diy_home: ['bosch'],
};

const KNOWN_BRANDS = [
  'la roche posay', 'optimum nutrition', 'the north face', 'the ordinary',
  'karl lagerfeld', 'tommy hilfiger', 'calvin klein', 'ralph lauren',
  'under armour', 'new balance', 'now foods', 'apple', 'samsung', 'xiaomi',
  'huawei', 'lenovo', 'asus', 'dell', 'hp', 'acer', 'msi', 'lg', 'sony',
  'philips', 'bosch', 'dyson', 'delonghi', 'roborock', 'garmin', 'logitech',
  'razer', 'corsair', 'kingston', 'sandisk', 'crucial', 'wd', 'seagate',
  'nvidia', 'amd', 'intel', 'nintendo', 'microsoft', 'oneplus', 'google',
  'nike', 'adidas', 'puma', 'reebok', 'asics', 'salomon', 'converse', 'vans',
  'jordan', 'hoka', 'skechers', 'timberland', 'north face', 'columbia',
  'zara', 'mango', 'levis', 'guess', 'lacoste', 'fila', 'gymbeam',
  'myprotein', 'biotechusa', 'biotech', 'scitec', 'nutrend', 'solgar',
  'cerave', 'vichy', 'bioderma', 'avene', 'eucerin', 'loreal', 'garnier',
  'nivea', 'dior', 'chanel', 'ysl', 'makita', 'dewalt', 'milwaukee',
  'einhell', 'karcher', 'ikea',
];

const ACCESSORY_TERMS = [
  'husa', 'huse', 'folie', 'folii', 'sticla', 'cablu', 'cabluri',
  'incarcator', 'curea', 'curele', 'adaptor', 'adaptoare', 'rezerva',
  'rezerve', 'carcasa', 'bratara', 'baterie externa', 'suport', 'dock',
  'statie incarcare', 'sireturi', 'branturi', 'protector', 'screen protector',
  'charger', 'cable', 'strap', 'adapter', 'bumper', 'case', 'cover',
];

const REFURBISHED_TERMS = [
  'resigilat', 'resigilata', 'resigilate', 'reconditionat', 'reconditionata',
  'reconditionate', 'refurbished', 'second hand', 'sh', 'folosit', 'utilizat',
  'open box', 'demo',
];

const MODEL_MODIFIERS = [
  'pro', 'max', 'plus', 'ultra', 'mini', 'fe', 'lite', 'se', 'ti', '5g',
];

const GATED_MODIFIER_SET = new Set(MODEL_MODIFIERS);

const SYNONYM_GROUPS = [
  ['adidasi', 'pantofi sport', 'sneakers', 'tenisi', 'incaltaminte sport'],
  ['pantofi', 'shoes'],
  ['geaca', 'jacheta', 'jacket', 'parka'],
  ['hanorac', 'hoodie', 'sweatshirt', 'bluza cu gluga'],
  ['tricou', 't shirt', 'tshirt'],
  ['pantaloni', 'pants', 'trousers'],
  ['blugi', 'jeans'],
  ['casti', 'headphones', 'earbuds', 'earphones'],
  ['proteina', 'whey', 'protein', 'proteine'],
  ['creatina', 'creatine'],
  ['negru', 'black', 'neagra'],
  ['alb', 'white', 'alba'],
  ['albastru', 'blue', 'albastra'],
  ['rosu', 'red', 'rosie'],
  ['verde', 'green'],
  ['gri', 'grey', 'gray'],
  ['telefon', 'smartphone', 'phone'],
  ['televizor', 'tv'],
  ['bormasina', 'masina de gaurit', 'drill'],
  ['carte', 'book'],
  ['crema', 'cream'],
  ['sampon', 'shampoo'],
  ['aspirator', 'vacuum'],
  ['ceas', 'smartwatch', 'watch'],
];

const SYNONYM_LOOKUP = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const term of group) {
    SYNONYM_LOOKUP.set(term, group);
  }
}

const NOISE_WORDS = new Set([
  'pret', 'preturi', 'ieftin', 'ieftine', 'oferta', 'oferte', 'reducere',
  'reduceri', 'original', 'originala', 'originale', 'nou', 'noua', 'livrare',
  'gratuita', 'gratuit', 'transport', 'stoc', 'magazin', 'online', 'romania',
  'ro', 'vanzare', 'cel', 'mai', 'bun', 'buna', 'comparatie', 'cadou',
  'marime', 'marimea', 'size', 'eu', 'telefon mobil', 'dual sim',
]);

const STOPWORDS = new Set([
  'de', 'cu', 'si', 'la', 'in', 'pe', 'din', 'sau', 'pentru', 'pt', 'al',
  'a', 'the', 'for', 'with', 'and', 'of', 'to', 'un', 'o', 'cel', 'mai',
  'barbati', 'femei', 'dama', 'unisex', 'copii',
]);

const TRACKING_PARAM_PREFIXES = ['utm_', 'x-search-', 'x-mb-', 'aff_', '2p_', 'ps_'];
const TRACKING_PARAM_EXACT = new Set([
  'fbclid', 'gclid', 'gad_source', 'gad_campaignid', 'gbraid', 'wbraid',
  'srsltid', 'ref', 'ref_', 'mc_cid', 'mc_eid', '_ga', '_gl', 'yclid',
  'msclkid', 'igshid',
]);

const SEO_STRIP_PHRASES = [
  'telefon mobil',
  'laptop gaming',
  'pantofi sport',
  'supliment alimentar',
  'pentru barbati',
  'pentru femei',
  'livrare gratuita',
  'transport gratuit',
  'dual sim',
  'in stoc',
  'de vanzare',
  'cel mai bun',
];

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTerm(normText, term) {
  if (!normText || !term) return false;
  return new RegExp(`(?:^|\\s)${escapeRegex(term)}(?:$|\\s)`).test(normText);
}

/**
 * Normalize text: lowercase, strip diacritics, convert decimal commas,
 * preserve M.2 cleanly, and split glued units while keeping 3G/4G/5G intact.
 */
function normalizeText(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\bm\.2\b/g, 'm2')
    .replace(/[^a-z0-9.]+/g, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\b(\d+)x(\d+(?:\.\d+)?)/g, '$1 x $2')
    .replace(/\b(eu)(\d{2})\b/g, '$1 $2')
    .replace(/\b(\d+(?:\.\d+)?)(tb|gb|mb|kg|ml|l|buc|bucati|caps|capsule|tabs|tablete|pastile|plicuri|eu|mah|hz|mm|cm)\b/g, '$1 $2')
    .replace(/\b(\d+\.\d+|\d{2,})(g)\b/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detect product category where explicit product nouns strictly outrank multi-category brands.
 */
function detectCategory(text) {
  const norm = normalizeText(text);
  if (!norm) return 'general';

  const scores = {
    shoes: 0,
    clothes: 0,
    electronics: 0,
    supplements: 0,
    pharmacy_beauty: 0,
    diy_home: 0,
    books: 0,
  };

  for (const [cat, keywords] of Object.entries(CATEGORY_EXPLICIT_KEYWORDS)) {
    for (const kw of keywords) {
      if (hasTerm(norm, kw)) {
        scores[cat] += 10;
      }
    }
  }

  for (const [cat, brands] of Object.entries(MULTI_CATEGORY_BRAND_HINTS)) {
    for (const brand of brands) {
      if (hasTerm(norm, brand)) {
        scores[cat] += 2;
      }
    }
  }

  let bestCat = 'general';
  let bestScore = 0;
  for (const [cat, sc] of Object.entries(scores)) {
    if (sc > bestScore) {
      bestScore = sc;
      bestCat = cat;
    }
  }
  return bestScore > 0 ? bestCat : 'general';
}

/**
 * Parse Romanian and international formatted prices, rejecting <= 0 or NaN.
 */
function parseRoPrice(input) {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? Number(input.toFixed(2)) : null;
  }
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();
  const match = trimmed.match(/-?\d+(?:[ \u00a0\u202f]\d{3})*(?:[.,]\d+)*/);
  if (!match) return null;

  let token = match[0].replace(/[ \u00a0\u202f]+/g, '');
  if (token.startsWith('-')) return null;

  const hasDot = token.includes('.');
  const hasComma = token.includes(',');

  if (hasDot && hasComma) {
    if (token.lastIndexOf(',') > token.lastIndexOf('.')) {
      token = token.replace(/\./g, '').replace(',', '.');
    } else {
      token = token.replace(/,/g, '');
    }
  } else if (hasComma) {
    const parts = token.split(',');
    if (parts.length > 2) {
      token = parts.join('');
    } else if (parts[1].length === 3 && parts[0] !== '0' && parts[0].length <= 3) {
      token = parts.join('');
    } else {
      token = `${parts[0]}.${parts[1]}`;
    }
  } else if (hasDot) {
    const parts = token.split('.');
    if (parts.length > 2) {
      token = parts.join('');
    } else if (parts[1].length === 3 && parts[0] !== '0' && parts[0].length <= 3) {
      token = parts.join('');
    }
  }

  const num = Number(token);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Number(num.toFixed(2));
}

function extractSize(normText, rawText, category) {
  // Explicit size cues work across sized categories and queries
  const explicit = normText.match(/\b(?:marimea|marime|size|eu)\s+(3[5-9]|4[0-8]|xxs|xs|s|m|l|xl|xxl|xxxl)\b/);
  if (explicit) {
    return { size: explicit[1].toUpperCase(), explicitMatch: explicit[0] };
  }

  // Standalone shoe sizes (35..47) only in shoes context and not followed by units
  if (category === 'shoes') {
    const shoeMatches = [...normText.matchAll(/(?:^|\s)(3[5-9]|4[0-7])(?=\s|$)/g)];
    for (const m of shoeMatches) {
      const after = normText.slice(m.index + m[0].length).trim();
      if (/^(?:mm|cm|g|kg|ml|l|gb|tb|w|hz|fps|ore|ani|zile)\b/.test(after)) continue;
      return { size: m[1], explicitMatch: null };
    }
  }

  // Standalone letter sizes only in clothes context and never glued/dotted (S24, M.2)
  if (category === 'clothes') {
    const rawSafe = (rawText || '').toLowerCase();
    const clothesMatch = normText.match(/(?:^|\s)(xxs|xs|s|m|l|xl|xxl|xxxl)(?=\s|$)/);
    if (clothesMatch) {
      const candidate = clothesMatch[1];
      const dotGuard = new RegExp(`\\b${candidate}\\.\\d|\\d\\.?${candidate}\\b`, 'i');
      if (!dotGuard.test(rawSafe)) {
        return { size: candidate.toUpperCase(), explicitMatch: null };
      }
    }
  }

  return { size: null, explicitMatch: null };
}

/**
 * Extract structured product attributes and cleanQuery from raw text.
 */
function extractAttributes(text, categoryHint = 'auto') {
  const raw = typeof text === 'string' ? text : '';
  const norm = normalizeText(raw);
  const category = categoryHint && categoryHint !== 'auto'
    ? categoryHint
    : detectCategory(raw);

  // Brand
  let brand = null;
  for (const b of KNOWN_BRANDS) {
    if (hasTerm(norm, b)) {
      brand = b === 'the north face' ? 'north face' : b;
      break;
    }
  }

  // Condition & accessories
  const isAccessory = ACCESSORY_TERMS.some((term) => hasTerm(norm, term));
  const isRefurbished = REFURBISHED_TERMS.some((term) => hasTerm(norm, term));

  // Modifiers
  const modifiers = MODEL_MODIFIERS.filter((mod) => hasTerm(norm, mod));

  // Units & multipacks
  let capacityGb = null;
  let weightG = null;
  let volumeMl = null;
  let packCount = null;
  const unitTokenValues = new Set();

  // Multipack pattern: e.g. "2 x 1 kg", "6 x 500 ml"
  const multiMatch = norm.match(/\b(\d+)\s+x\s+(\d+(?:\.\d+)?)\s+(tb|gb|mb|kg|g|ml|l)\b/);
  if (multiMatch) {
    const count = Number(multiMatch[1]);
    const val = Number(multiMatch[2]);
    const unit = multiMatch[3];
    if (count > 0 && val > 0) {
      packCount = count;
      unitTokenValues.add(String(count));
      unitTokenValues.add(String(val));
      if (unit === 'tb') capacityGb = Math.round(count * val * 1000);
      else if (unit === 'gb') capacityGb = Math.round(count * val);
      else if (unit === 'kg') weightG = Math.round(count * val * 1000);
      else if (unit === 'g') weightG = Math.round(count * val);
      else if (unit === 'l') volumeMl = Math.round(count * val * 1000);
      else if (unit === 'ml') volumeMl = Math.round(count * val);
    }
  }

  // Storage capacity (prefer storage over RAM when multiple GB/TB values appear)
  if (capacityGb == null) {
    const capMatches = [...norm.matchAll(/\b(\d+(?:\.\d+)?)\s+(tb|gb)\b/g)];
    if (capMatches.length > 0) {
      const parsed = capMatches.map((m) => {
        const num = Number(m[1]);
        const after = norm.slice(m.index + m[0].length).trim();
        const isRam = /^ram\b/.test(after);
        const gb = m[2] === 'tb' ? Math.round(num * 1000) : Math.round(num);
        unitTokenValues.add(m[1]);
        return { gb, isRam };
      });
      const nonRam = parsed.filter((c) => !c.isRam);
      const pool = nonRam.length > 0 ? nonRam : parsed;
      capacityGb = Math.max(...pool.map((c) => c.gb));
    }
  }

  // Weight
  if (weightG == null) {
    const wMatch = norm.match(/\b(\d+(?:\.\d+)?)\s+(kg|g)\b/);
    if (wMatch) {
      const val = Number(wMatch[1]);
      const unit = wMatch[2];
      // Guard against "5 g" in electronics
      if (!(category === 'electronics' && unit === 'g' && val <= 5)) {
        weightG = unit === 'kg' ? Math.round(val * 1000) : Math.round(val);
        unitTokenValues.add(wMatch[1]);
      }
    }
  }

  // Volume
  if (volumeMl == null) {
    const vMatch = norm.match(/\b(\d+(?:\.\d+)?)\s+(ml|l)\b/);
    if (vMatch) {
      const val = Number(vMatch[1]);
      volumeMl = vMatch[2] === 'l' ? Math.round(val * 1000) : Math.round(val);
      unitTokenValues.add(vMatch[1]);
    }
  }

  // Pack count from buc/caps/tabs or "set 3"
  if (packCount == null) {
    const pMatch = norm.match(/\b(\d+)\s+(?:buc|bucati|caps|capsule|tabs|tablete|pastile|plicuri|doze|serviri|servings)\b/)
      || norm.match(/\b(?:set|pachet|pack)(?:\s+de)?\s+(\d+)\b/);
    if (pMatch) {
      packCount = Number(pMatch[1]);
      unitTokenValues.add(pMatch[1]);
    }
  }

  // Size extraction
  const { size, explicitMatch } = extractSize(norm, raw, category);

  // Clean query: remove explicit size phrases, noise words, and unit noise if unneeded?
  // Keep units in cleanQuery (important for 256GB / 2kg search precision!), strip marimea/eu/pret/ieftin.
  let clean = norm;
  if (explicitMatch) {
    clean = clean.replace(new RegExp(`(?:^|\\s)${escapeRegex(explicitMatch)}(?=\\s|$)`, 'g'), ' ');
  } else if (size && (category === 'shoes' || category === 'clothes')) {
    const szLower = size.toLowerCase();
    // Only strip standalone size token when not part of a known model number like "air force 1"
    if (category === 'shoes' && Number(szLower) >= 35) {
      clean = clean.replace(new RegExp(`(?:^|\\s)${escapeRegex(szLower)}(?=\\s|$)`, 'g'), ' ');
    }
  }
  const cleanTokens = clean
    .split(' ')
    .filter((t) => t && !NOISE_WORDS.has(t));
  const cleanQuery = cleanTokens.join(' ').trim();

  // Model tokens: meaningful tokens excluding brand, stopwords, units, size, and modifiers
  const brandWords = new Set(brand ? brand.split(' ') : []);
  const unitLabels = new Set(['tb', 'gb', 'mb', 'kg', 'g', 'ml', 'l', 'x', 'buc', 'bucati', 'caps', 'capsule', 'tabs', 'tablete', 'pastile', 'plicuri', 'doze', 'serviri', 'servings']);
  const modelTokens = [];
  for (const tok of cleanTokens) {
    if (STOPWORDS.has(tok)) continue;
    if (brandWords.has(tok)) continue;
    if (unitLabels.has(tok)) continue;
    if (unitTokenValues.has(tok)) continue;
    if (size && tok === size.toLowerCase()) continue;
    if (GATED_MODIFIER_SET.has(tok)) continue;
    if (tok.length < 1) continue;
    if (!modelTokens.includes(tok)) modelTokens.push(tok);
  }

  return {
    brand,
    modelTokens,
    modifiers,
    capacityGb,
    weightG,
    volumeMl,
    packCount,
    size,
    isAccessory,
    isRefurbished,
    cleanQuery,
  };
}

function tokenMatchesCandidate(token, candidateNorm) {
  if (hasTerm(candidateNorm, token)) return true;
  const syns = SYNONYM_LOOKUP.get(token);
  if (syns) {
    return syns.some((s) => hasTerm(candidateNorm, s));
  }
  return false;
}

function expandPhraseTokens(normText) {
  // Identify multi-word synonym phrases in normText so e.g. "pantofi sport" matches "adidasi"
  const matchedPhrases = [];
  for (const group of SYNONYM_GROUPS) {
    for (const term of group) {
      if (term.includes(' ') && hasTerm(normText, term)) {
        matchedPhrases.push({ phrase: term, group });
      }
    }
  }
  return matchedPhrases;
}

function computeUnitPriceLabel(price, attrs) {
  const num = parseRoPrice(price);
  if (num == null) return null;
  if (attrs.weightG && attrs.weightG > 0) {
    const perKg = num / (attrs.weightG / 1000);
    return `${perKg.toFixed(2)} lei/kg`;
  }
  if (attrs.volumeMl && attrs.volumeMl > 0) {
    const perL = num / (attrs.volumeMl / 1000);
    return `${perL.toFixed(2)} lei/l`;
  }
  if (attrs.packCount && attrs.packCount > 1) {
    const perBuc = num / attrs.packCount;
    return `${perBuc.toFixed(2)} lei/buc`;
  }
  return null;
}

function rejectResult(reason, attributes, unitPriceLabel = null) {
  return {
    score: 0,
    variantBucket: 'different_variant',
    rejected: true,
    rejectReason: reason,
    unitPriceLabel,
    attributes,
  };
}

/**
 * Score a candidate title against a query with hard gates, RO/EN synonyms,
 * variant bucketing, and unit-price computation.
 */
function scoreCandidate(candidateTitle, query, { category = 'auto', price = null } = {}) {
  const effectiveCategory = category && category !== 'auto' ? category : detectCategory(query);
  const qAttr = extractAttributes(query, effectiveCategory);
  const cAttr = extractAttributes(candidateTitle, effectiveCategory);
  const cNorm = normalizeText(candidateTitle);
  const qNorm = qAttr.cleanQuery || normalizeText(query);
  const unitPriceLabel = computeUnitPriceLabel(price, cAttr);

  if (!cNorm || !qNorm) {
    return rejectResult('empty_input', cAttr, unitPriceLabel);
  }

  // Hard gates: accessories & refurbished
  if (cAttr.isAccessory && !qAttr.isAccessory) {
    return rejectResult('accessory_mismatch', cAttr, unitPriceLabel);
  }
  if (cAttr.isRefurbished && !qAttr.isRefurbished) {
    return rejectResult('refurbished_mismatch', cAttr, unitPriceLabel);
  }

  // Hard gate: brand mismatch when both explicitly identify different brands
  if (qAttr.brand && cAttr.brand && qAttr.brand !== cAttr.brand) {
    return rejectResult('brand_mismatch', cAttr, unitPriceLabel);
  }

  // Hard gate: model modifiers must match symmetrically
  const qMods = new Set(qAttr.modifiers);
  const cMods = new Set(cAttr.modifiers);
  for (const m of cMods) {
    if (!qMods.has(m)) return rejectResult('modifier_mismatch', cAttr, unitPriceLabel);
  }
  for (const m of qMods) {
    if (!cMods.has(m)) return rejectResult('modifier_mismatch', cAttr, unitPriceLabel);
  }

  // Hard gate: numeric model tokens (e.g. 15, 30) & alphanumeric codes (s24, a55, ps5)
  for (const tok of qAttr.modelTokens) {
    if (/^\d+$/.test(tok)) {
      if (!hasTerm(cNorm, tok)) {
        return rejectResult('model_number_mismatch', cAttr, unitPriceLabel);
      }
    } else if (/^[a-z]+\d+[a-z]*$/.test(tok)) {
      if (!hasTerm(cNorm, tok)) {
        return rejectResult('model_code_mismatch', cAttr, unitPriceLabel);
      }
    }
  }

  // Variant bucketing
  let variantBucket = 'exact_variant';
  const markBucket = (next) => {
    if (next === 'different_variant') variantBucket = 'different_variant';
    else if (next === 'unverified_variant' && variantBucket === 'exact_variant') {
      variantBucket = 'unverified_variant';
    }
  };

  if (qAttr.capacityGb != null) {
    if (cAttr.capacityGb == null) markBucket('unverified_variant');
    else if (cAttr.capacityGb !== qAttr.capacityGb) markBucket('different_variant');
  }
  if (qAttr.weightG != null) {
    if (cAttr.weightG == null) markBucket('unverified_variant');
    else if (Math.abs(cAttr.weightG - qAttr.weightG) / qAttr.weightG > 0.05) {
      markBucket('different_variant');
    }
  }
  if (qAttr.volumeMl != null) {
    if (cAttr.volumeMl == null) markBucket('unverified_variant');
    else if (Math.abs(cAttr.volumeMl - qAttr.volumeMl) / qAttr.volumeMl > 0.05) {
      markBucket('different_variant');
    }
  }
  if (qAttr.packCount != null && qAttr.weightG == null && qAttr.volumeMl == null) {
    if (cAttr.packCount == null) markBucket('unverified_variant');
    else if (cAttr.packCount !== qAttr.packCount) markBucket('different_variant');
  }

  // Token matching with bidirectional RO/EN synonyms (including multi-word phrases)
  const qPhraseMatches = expandPhraseTokens(qNorm);
  const consumedQueryWords = new Set();
  const coreMatches = [];

  for (const pm of qPhraseMatches) {
    const words = pm.phrase.split(' ');
    const matchedInCand = pm.group.some((syn) => hasTerm(cNorm, syn));
    words.forEach((w) => consumedQueryWords.add(w));
    coreMatches.push(matchedInCand);
  }

  const qTokensForScore = qAttr.modelTokens.filter((t) => !consumedQueryWords.has(t));
  for (const tok of qTokensForScore) {
    coreMatches.push(tokenMatchesCandidate(tok, cNorm));
  }

  const totalCore = coreMatches.length;
  const matchedCore = coreMatches.filter(Boolean).length;
  const coreRecall = totalCore > 0 ? matchedCore / totalCore : 1;

  // Brand alignment
  let brandScore = 1;
  if (qAttr.brand) {
    brandScore = (cAttr.brand === qAttr.brand || hasTerm(cNorm, qAttr.brand)) ? 1 : 0;
  }

  if (coreRecall < 0.5 || (qAttr.brand && brandScore === 0)) {
    return rejectResult(brandScore === 0 ? 'brand_mismatch' : 'low_token_overlap', cAttr, unitPriceLabel);
  }

  // Precision term over candidate model tokens
  const cTokens = cAttr.modelTokens.length;
  const corePrecision = cTokens > 0 ? Math.min(1, matchedCore / cTokens) : coreRecall;
  const coreF1 = (coreRecall + corePrecision) > 0
    ? (2 * coreRecall * corePrecision) / (coreRecall + corePrecision)
    : 0;

  const variantScore = variantBucket === 'exact_variant'
    ? 1
    : variantBucket === 'unverified_variant' ? 0.55 : 0.15;

  const score = Number((
    0.45 * coreRecall +
    0.15 * coreF1 +
    0.20 * brandScore +
    0.20 * variantScore
  ).toFixed(4));

  return {
    score,
    variantBucket,
    rejected: false,
    rejectReason: null,
    unitPriceLabel,
    attributes: cAttr,
  };
}

/**
 * Canonicalize URL: lowercase host, strip www./m., drop hash, strip tracking params,
 * sort remaining meaningful query params.
 */
function canonicalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';

    const host = parsed.hostname.toLowerCase().replace(/^(?:www|m)\.(?=[^.]+\.)/, '');
    let pathname = parsed.pathname.replace(/\/+$/, '') || '/';

    const keptParams = [];
    for (const [k, v] of parsed.searchParams.entries()) {
      const kl = k.toLowerCase();
      if (TRACKING_PARAM_EXACT.has(kl)) continue;
      if (TRACKING_PARAM_PREFIXES.some((p) => kl.startsWith(p))) continue;
      keptParams.push([k, v]);
    }
    keptParams.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

    const search = keptParams.length > 0
      ? `?${new URLSearchParams(keptParams).toString()}`
      : '';
    return `${parsed.protocol}//${host}${pathname}${search}`;
  } catch {
    return '';
  }
}

/**
 * Extract immutable store SKU/product key or fall back to canonicalized URL.
 */
function extractStoreProductKey(url, storeId = null) {
  const canonical = canonicalizeUrl(url);
  if (!canonical) return '';

  try {
    const parsed = new URL(canonical);
    const host = parsed.hostname;
    const path = parsed.pathname;
    const idHint = (storeId || '').toLowerCase();

    if (idHint === 'emag' || host.endsWith('emag.ro')) {
      const m = path.match(/\/pd\/([A-Za-z0-9]+)/);
      if (m) return `emag:${m[1].toUpperCase()}`;
    }
    if (idHint === 'altex' || host.endsWith('altex.ro') || host.endsWith('mediagalaxy.ro')) {
      const m = path.match(/\/cpd\/([A-Za-z0-9-]+)/);
      if (m) return `altex:${m[1].toUpperCase()}`;
    }
    if (idHint === 'fashiondays' || host.endsWith('fashiondays.ro')) {
      const m = path.match(/\/p\/[^/]+-(\d+)/);
      if (m) return `fashiondays:${m[1]}`;
    }
    if (idHint === 'trendyol' || host.includes('trendyol.com')) {
      const m = path.match(/-p-(\d+)/);
      if (m) {
        const merchantId = parsed.searchParams.get('merchantId');
        return merchantId ? `trendyol:${m[1]}:m${merchantId}` : `trendyol:${m[1]}`;
      }
    }
    if (idHint === 'decathlon' || host.endsWith('decathlon.ro')) {
      const m = path.match(/\/R-p-(\d+)/i);
      if (m) return `decathlon:${m[1]}`;
    }
    if (idHint === 'zalando' || host.endsWith('zalando.ro')) {
      const m = path.match(/-([a-z0-9]{9,})\.html$/i);
      if (m) return `zalando:${m[1].toLowerCase()}`;
    }
    if (idHint === 'notino' || host.endsWith('notino.ro')) {
      const m = path.match(/\/p-(\d+)/i);
      if (m) return `notino:${m[1]}`;
    }
    if (idHint === 'dedeman' || host.endsWith('dedeman.ro')) {
      const m = path.match(/\/p\/(\d+)/i);
      if (m) return `dedeman:${m[1]}`;
    }
    if (idHint === 'ikea' || host.endsWith('ikea.com')) {
      const m = path.match(/-(s?\d{8})(?:\/|$)/i);
      if (m) return `ikea:${m[1].toLowerCase()}`;
    }
  } catch {
    return canonical;
  }

  return canonical;
}

/**
 * Build cross-store canonical product cluster key: GTIN -> MPN -> brand|modelTokens|variantUnit.
 */
function buildClusterKey(item) {
  if (!item || typeof item !== 'object') return 'unknown|unknown|base';

  const rawGtin = String(item.gtin || item.ean || '').replace(/[^0-9]/g, '');
  if (rawGtin.length >= 8 && rawGtin.length <= 14) {
    return `gtin:${rawGtin}`;
  }

  const brandNorm = normalizeText(item.brand || '');
  if (item.mpn && String(item.mpn).trim()) {
    const cleanMpn = String(item.mpn).trim().toLowerCase().replace(/\s+/g, '');
    return `mpn:${brandNorm || 'unknown'}:${cleanMpn}`;
  }

  const title = item.title || item.productTitle || '';
  const attrs = item.attributes || extractAttributes(title, item.category || 'auto');
  const brand = brandNorm || attrs.brand || 'unknown';
  const modelPart = [...attrs.modelTokens, ...attrs.modifiers].slice(0, 5).join('_') || 'product';

  let variantUnit = 'base';
  if (attrs.capacityGb != null) variantUnit = `${attrs.capacityGb}gb`;
  else if (attrs.weightG != null) variantUnit = `${attrs.weightG}g`;
  else if (attrs.volumeMl != null) variantUnit = `${attrs.volumeMl}ml`;
  else if (attrs.packCount != null) variantUnit = `${attrs.packCount}x`;

  return `${brand}|${modelPart}|${variantUnit}`;
}

/**
 * Distill noisy SEO product titles into 3-6 clean search tokens.
 */
function distillQuery(rawTitle, brand = '') {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return normalizeText(brand);
  }

  let cleaned = rawTitle
    .replace(/\s*[-|–]\s*(?:eMAG\.ro|Altex|Media Galaxy|PC Garage|Flanco|Fashion Days|Answear|epantofi|About You|Zalando|GymBeam|Dr\.?Max|Notino|Dedeman|Carturesti).*$/i, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]/g, ' ');

  let norm = normalizeText(cleaned);
  for (const phrase of SEO_STRIP_PHRASES) {
    norm = norm.replace(new RegExp(`(?:^|\\s)${escapeRegex(phrase)}(?=\\s|$)`, 'g'), ' ');
  }

  // Re-glue split units in search query (e.g. "128 gb" -> "128gb", "2.5 kg" -> "2.5kg") so 3-6 tokens carry full info
  norm = norm
    .replace(/\b(\d+(?:\.\d+)?)\s+(tb|gb|kg|g|ml|l)\b/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = [];
  const brandTokens = normalizeText(brand).split(' ').filter(Boolean);
  for (const bt of brandTokens) {
    if (!tokens.includes(bt)) tokens.push(bt);
  }

  for (const tok of norm.split(' ')) {
    if (!tok) continue;
    if (NOISE_WORDS.has(tok) || STOPWORDS.has(tok)) continue;
    if (ACCESSORY_TERMS.includes(tok) && !brandTokens.includes(tok)) continue;
    if (!tokens.includes(tok)) tokens.push(tok);
  }

  return tokens.slice(0, 6).join(' ');
}

module.exports = {
  normalizeText,
  detectCategory,
  parseRoPrice,
  extractAttributes,
  scoreCandidate,
  canonicalizeUrl,
  extractStoreProductKey,
  buildClusterKey,
  distillQuery,
};
