'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeText,
  detectCategory,
  parseRoPrice,
  extractAttributes,
  scoreCandidate,
  canonicalizeUrl,
  extractStoreProductKey,
  buildClusterKey,
  distillQuery,
} = require('../lib/matching');

test('normalizeText strips diacritics, converts decimal commas, and splits glued units', () => {
  assert.equal(normalizeText('Creatină Monohidrată 500g'), 'creatina monohidrata 500 g');
  assert.equal(normalizeText('Proteina Whey 2,5kg Ciocolată'), 'proteina whey 2.5 kg ciocolata');
  assert.equal(normalizeText('iPhone 15 256GB 5G'), 'iphone 15 256 gb 5g');
  assert.equal(normalizeText('Pachet 2x1kg + 1,5L'), 'pachet 2 x 1 kg 1.5 l');
  assert.equal(normalizeText('SSD Samsung 990 PRO 1TB M.2'), 'ssd samsung 990 pro 1 tb m2');
});

test('detectCategory prioritizes explicit product nouns over multi-category brands', () => {
  assert.equal(detectCategory('Tricou Nike Dri-FIT negru'), 'clothes');
  assert.equal(detectCategory('Hanorac Adidas Essentials'), 'clothes');
  assert.equal(detectCategory('Geaca Puma iarna'), 'clothes');
  assert.equal(detectCategory('Adidasi Nike Air Force 1'), 'shoes');
  assert.equal(detectCategory('Pantofi sport Adidas Ultraboost'), 'shoes');
  assert.equal(detectCategory('Laptop Lenovo ThinkPad 16GB'), 'electronics');
  assert.equal(detectCategory('Proteina Whey Gold Standard 2kg'), 'supplements');
  assert.equal(detectCategory('Crema hidratanta CeraVe SPF 50'), 'pharmacy_beauty');
  assert.equal(detectCategory('Bormasina Bosch cu acumulator'), 'diy_home');
  assert.equal(detectCategory('Carte Dune Frank Herbert Editura Nemira'), 'books');
  assert.equal(detectCategory('produs necunoscut xyz'), 'general');
});

test('parseRoPrice handles RO/EU/US formats and rejects invalid or <= 0 values', () => {
  assert.equal(parseRoPrice('1.299,99 lei'), 1299.99);
  assert.equal(parseRoPrice('1 299,99 RON'), 1299.99);
  assert.equal(parseRoPrice('1\u00a0299,99'), 1299.99);
  assert.equal(parseRoPrice('1299.99'), 1299.99);
  assert.equal(parseRoPrice('89,90'), 89.9);
  assert.equal(parseRoPrice('1.299'), 1299);
  assert.equal(parseRoPrice('0'), null);
  assert.equal(parseRoPrice('-45,90'), null);
  assert.equal(parseRoPrice('gratuit'), null);
  assert.equal(parseRoPrice(NaN), null);
  assert.equal(parseRoPrice(0), null);
  assert.equal(parseRoPrice(-10), null);
});

test('extractAttributes handles unit canonicalization, multipacks, accessories, and safe sizes', () => {
  const ssd = extractAttributes('SSD Samsung 990 PRO 2TB M.2 NVMe', 'electronics');
  assert.equal(ssd.brand, 'samsung');
  assert.equal(ssd.capacityGb, 2000);
  assert.deepEqual(ssd.modifiers, ['pro']);
  assert.equal(ssd.size, null);

  const phone = extractAttributes('Samsung Galaxy S24 256GB 5G', 'electronics');
  assert.equal(phone.brand, 'samsung');
  assert.equal(phone.capacityGb, 256);
  assert.equal(phone.size, null);
  assert.deepEqual(phone.modifiers, ['5g']);

  const pack = extractAttributes('Proteina Whey 2 x 1kg', 'supplements');
  assert.equal(pack.packCount, 2);
  assert.equal(pack.weightG, 2000);

  const vol = extractAttributes('Lotiune CeraVe 1l', 'pharmacy_beauty');
  assert.equal(vol.volumeMl, 1000);

  const shoes = extractAttributes('Adidasi Nike Air Force 1 marimea 42 pret ieftin', 'shoes');
  assert.equal(shoes.brand, 'nike');
  assert.equal(shoes.size, '42');
  assert.equal(shoes.cleanQuery, 'adidasi nike air force 1');

  const clothes = extractAttributes('Tricou Adidas Negru EU L', 'clothes');
  assert.equal(clothes.size, 'L');
  assert.equal(clothes.cleanQuery, 'tricou adidas negru');

  const acc = extractAttributes('Husa silicon iPhone 15', 'electronics');
  assert.equal(acc.isAccessory, true);

  const ref = extractAttributes('iPhone 15 128GB Resigilat', 'electronics');
  assert.equal(ref.isRefurbished, true);
});

test('scoreCandidate enforces hard gates, RO/EN synonyms, ±5% tolerance, and unitPriceLabel', () => {
  // Accessory & refurb gates
  const accHit = scoreCandidate('Husa silicon Apple iPhone 15 128GB', 'iPhone 15 128GB');
  assert.equal(accHit.rejected, true);
  assert.equal(accHit.rejectReason, 'accessory_mismatch');

  const refHit = scoreCandidate('Apple iPhone 15 128GB Resigilat', 'iPhone 15 128GB');
  assert.equal(refHit.rejected, true);
  assert.equal(refHit.rejectReason, 'refurbished_mismatch');

  // Modifier gate (Pro vs base)
  const modHit = scoreCandidate('Apple iPhone 15 Pro 128GB', 'iPhone 15 128GB');
  assert.equal(modHit.rejected, true);
  assert.equal(modHit.rejectReason, 'modifier_mismatch');

  // 5G in RO phone listing must NOT fail modifier gate when omitted from query
  const fiveGHit = scoreCandidate('Telefon mobil Apple iPhone 15, 128GB, 5G, Blue', 'iPhone 15 128GB');
  assert.equal(fiveGHit.rejected, false);
  assert.equal(fiveGHit.variantBucket, 'exact_variant');

  // Numeric model gate (15 vs 1500 or 30 vs 29)
  const numHit = scoreCandidate('Asics Gel Kayano 29', 'Asics Gel Kayano 30');
  assert.equal(numHit.rejected, true);
  assert.equal(numHit.rejectReason, 'model_number_mismatch');

  const wordBoundaryHit = scoreCandidate('Incarcator 1500W', 'iPhone 15');
  assert.equal(wordBoundaryHit.rejected, true);

  // Different capacity bucket
  const diffCap = scoreCandidate('Apple iPhone 15 256GB Black', 'iPhone 15 128GB');
  assert.equal(diffCap.rejected, false);
  assert.equal(diffCap.variantBucket, 'different_variant');

  // Unverified variant when snippet omits capacity
  const unverifiedCap = scoreCandidate('Apple iPhone 15 Negru', 'iPhone 15 128GB');
  assert.equal(unverifiedCap.rejected, false);
  assert.equal(unverifiedCap.variantBucket, 'unverified_variant');

  // Bidirectional RO/EN synonyms + ±5% weight tolerance + unitPriceLabel
  const wheyExact = scoreCandidate('Proteina din zer Optimum Nutrition 2200g', 'Whey Optimum Nutrition 2.27kg', { price: 330 });
  assert.equal(wheyExact.rejected, false);
  assert.equal(wheyExact.variantBucket, 'exact_variant');
  assert.equal(wheyExact.unitPriceLabel, '150.00 lei/kg');
  assert.ok(wheyExact.score >= 0.8);

  const sneakerSyn = scoreCandidate('Pantofi sport Nike Air Force 1 07 Alb', 'Adidasi Nike Air Force 1 White');
  assert.equal(sneakerSyn.rejected, false);
  assert.ok(sneakerSyn.score >= 0.85);
});

test('canonicalizeUrl, extractStoreProductKey, buildClusterKey, and distillQuery work accurately', () => {
  const canon = canonicalizeUrl('https://WWW.eMAG.ro/telefon-apple/pd/D123ABC/?utm_source=google&fbclid=xyz&variant=black&id=99#reviews');
  assert.equal(canon, 'https://emag.ro/telefon-apple/pd/D123ABC?id=99&variant=black');

  const canonMobile = canonicalizeUrl('https://m.altex.ro/laptop/cpd/LAP99-X/?gad_source=1&2p_click=abc');
  assert.equal(canonMobile, 'https://altex.ro/laptop/cpd/LAP99-X');

  assert.equal(extractStoreProductKey('https://www.emag.ro/iphone-15/pd/DX9988BBM/?utm_campaign=x', 'emag'), 'emag:DX9988BBM');
  assert.equal(extractStoreProductKey('https://altex.ro/ssd/cpd/SSD-1TB-99/', 'altex'), 'altex:SSD-1TB-99');
  assert.equal(extractStoreProductKey('https://www.fashiondays.ro/p/hanorac-nike-543210/', 'fashiondays'), 'fashiondays:543210');
  assert.equal(extractStoreProductKey('https://www.trendyol.com/ro/nike/tricou-p-987654?merchantId=42', 'trendyol'), 'trendyol:987654:m42');

  assert.equal(buildClusterKey({ gtin: '0194253715887', title: 'iPhone 15' }), 'gtin:0194253715887');
  assert.equal(buildClusterKey({ brand: 'Apple', mpn: 'MTP03PX/A', title: 'iPhone 15' }), 'mpn:apple:mtp03px/a');
  assert.equal(buildClusterKey({ title: 'Apple iPhone 15 128GB Black' }), 'apple|iphone_15_black|128gb');

  const distilled = distillQuery('Telefon mobil Apple iPhone 15, Dual SIM, 128GB, 5G, Negru + Livrare gratuita - eMAG.ro', 'Apple');
  const tokens = distilled.split(' ');
  assert.ok(tokens.length >= 3 && tokens.length <= 6);
  assert.ok(distilled.includes('apple'));
  assert.ok(distilled.includes('iphone'));
  assert.ok(distilled.includes('15'));
  assert.ok(distilled.includes('128gb'));
});
