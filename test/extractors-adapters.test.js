'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { URL } = require('node:url');

const {
  extractMetadataFromHtml,
  extractPriceFromHtml,
  extractStockAndSizesFromHtml,
} = require('../lib/extractors');

const {
  loadStores,
  loadStoresCatalog,
  getPublicStoresSummary,
  resolveStore,
  runStoreAdapters,
  buildAdapterSearchQuery,
  searchSerperShoppingRo,
  parseAltexFenrirResponse,
  parseMagento2GraphqlResponse,
  parseShopifySuggestResponse,
  parseVtexSearchResponse,
  parseEmagHtml,
  parseCheerioCatalogHtml,
  parseBingShoppingHtml,
  decodeBingClickTarget,
} = require('../lib/adapters');

const { parseRoPrice } = require('../lib/matching');
const { circuitBreaker } = require('../lib/http-client');

// --- 1. data/stores.json schema integrity (34+ stores, no 'general' bleed, real RO checkout rules) ---

test('data/stores.json schema integrity: 34+ RO stores, explicit verticals, real checkout rules', () => {
  const catalog = loadStoresCatalog();
  const stores = loadStores();

  assert.ok(stores.length >= 34, `Expected >= 34 stores, got ${stores.length}`);
  assert.ok(Array.isArray(catalog.membershipPrograms) && catalog.membershipPrograms.length >= 3);

  const ids = new Set();
  for (const s of stores) {
    assert.ok(s.id && s.name, `Missing id/name on store ${JSON.stringify(s)}`);
    assert.ok(!ids.has(s.id), `Duplicate store id: ${s.id}`);
    ids.add(s.id);

    assert.ok(Array.isArray(s.domains) && s.domains.length >= 1, `Missing domains on ${s.id}`);
    assert.ok(['1p', 'marketplace_hybrid', 'marketplace_pure'].includes(s.businessModel), `Invalid businessModel on ${s.id}`);
    assert.ok(Array.isArray(s.categories) && s.categories.length >= 1, `Empty categories on ${s.id}`);
    assert.ok(!s.categories.includes('general'), `Category 'general' bleed found on ${s.id}`);
    assert.ok(s.shipping && s.shipping.channels, `Missing shipping.channels on ${s.id}`);
    assert.ok(s.payment && s.payment.ramburs, `Missing payment.ramburs on ${s.id}`);
    assert.ok(s.returns && typeof s.returns.days === 'number', `Missing returns on ${s.id}`);
    assert.ok(s.ingestion && typeof s.ingestion.tier === 'number' && s.ingestion.searchUrlTemplate, `Missing ingestion on ${s.id}`);
  }

  const byId = new Map(stores.map((s) => [s.id, s]));

  // Accurate RO checkout rules
  assert.equal(byId.get('altex').shipping.channels.courier.freeThreshold, 400);
  assert.equal(byId.get('altex').payment.ramburs.maxWeightKg, 75);
  assert.ok(byId.get('altex').domains.includes('mediagalaxy.ro'));

  assert.equal(byId.get('trendyol').payment.ramburs.fee, 19.99);
  assert.equal(byId.get('trendyol').payment.ramburs.nonRefundableOnReturn, true);

  assert.equal(byId.get('aboutyou').shipping.channels.courier.freeThreshold, 99);
  assert.equal(byId.get('aboutyou').shipping.channels.courier.fee, 9.9);

  assert.equal(byId.get('pcgarage').shipping.channels.courier.freeThreshold, 500);
  assert.equal(byId.get('pcgarage').shipping.channels.easybox.requiresOnlinePay, true);
  assert.equal(byId.get('pcgarage').shipping.channels.courier.maxWeightKg, 7);
  assert.equal(byId.get('pcgarage').payment.ramburs.disablesFreeShipping, true);

  assert.equal(byId.get('drmax').shipping.channels.courier.freeThreshold, 300);
  assert.equal(byId.get('drmax').shipping.channels.clickAndCollect.fee, 0);

  assert.equal(byId.get('answear').shipping.channels.courier.freeThreshold, 330);
  assert.equal(byId.get('answear').returns.freeReturnMinOrderRon, 330);

  assert.equal(byId.get('emag').shipping.membershipProgram.lockerFreeThreshold, 30);
  assert.equal(byId.get('emag').shipping.membershipProgram.courierFreeThreshold, 100);

  for (const diy of ['dedeman', 'hornbach', 'ikea']) {
    assert.equal(byId.get(diy).shipping.bulkyPolicy, 'dynamic_checkout_only');
  }

  assert.ok(byId.get('epantofi').domains.includes('modivo.ro'));

  const summary = getPublicStoresSummary();
  assert.equal(summary.total, stores.length);
  assert.equal(summary.stores.length, stores.length);
  assert.ok(summary.membershipPrograms.length >= 3);
});

test('buildAdapterSearchQuery maps TN and colors to Romanian storefront terms', () => {
  assert.equal(buildAdapterSearchQuery('nike air max tn triple black'), 'nike air max plus tn negru');
  assert.equal(buildAdapterSearchQuery('Nike Air Max TN White'), 'nike air max plus tn alb');
  assert.equal(buildAdapterSearchQuery('nike air max plus negru'), 'nike air max plus negru');
});

test('Bing Shopping parser unwraps click targets and reads keyless merchant offers', () => {
  const target = 'https://www.footshop.ro/ro/incalaminte-i-sneakeri-pentru-barbai/nike.html?size=41';
  const affiliate = `https://ro.expandeo.com/ex/bing-css?url=${encodeURIComponent(target)}`;
  const encoded = Buffer.from(encodeURIComponent(affiliate)).toString('base64url');
  const href = `https://www.bing.com/aclick?u=${encoded}`;

  assert.equal(decodeBingClickTarget(href), target);

  const html = `<div class="br-gOffCard">
    <a class="br-offLink" href="${href}">
      <div class="br-offInfo">
        <div class="br-offTtl"><span title="Nike Air Max Plus TN VII Black/ Black-Anthracite">Nike Air Max Plus TN VII Black…</span></div>
        <div class="br-offPrice"><div class="br-price">950,00 lei</div></div>
        <div class="br-offSlr"><span class="br-offSlrTxt">Footshop.ro</span></div>
      </div>
    </a>
    <a class="br-offLink" href="${href}">
      <div class="br-offTtl"><span title="Nike Air Max Plus TN VII Black/ Black-Anthracite 12.5">Nike Air Max Plus TN VII Black 12.5</span></div>
      <div class="br-price">68.389 Ft</div>
      <span class="br-offSlrTxt">Footshop.hu</span>
    </a>
  </div>`;

  const matches = parseBingShoppingHtml(html);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, 'Nike Air Max Plus TN VII Black/ Black-Anthracite');
  assert.equal(matches[0].price, 950);
  assert.equal(matches[0].priceLabel, '950,00 lei');
  assert.equal(matches[0].customStoreName, 'Footshop.ro');
  assert.equal(matches[0].priceSource, 'tier3_bing');
  assert.equal(matches[0].url, target);
});

test('resolveStore resolves domains, aliases, 3P marketplace strings, and unknown external RO sites', () => {
  assert.equal(resolveStore(null, 'https://mediagalaxy.ro/telefon/cpd/123/').id, 'altex');
  assert.equal(resolveStore(null, 'https://www.modivo.ro/p/nike-air-force').id, 'epantofi');
  assert.equal(resolveStore('eMAG Marketplace - Partner SRL', null).id, 'emag');
  assert.equal(resolveStore(null, 'https://www.trendyol.com/ro/p-12345').id, 'trendyol');

  const ext = resolveStore('NicheShop RO', 'https://www.nicheshop.ro/produs/1');
  assert.equal(ext.id, 'ext_nicheshop_ro');
  assert.equal(ext.domains[0], 'nicheshop.ro');
});

// --- 2. Extractors: JSON-LD currency, parseRoPrice negative context, 3-state stock/sizes ---

test('extractMetadataFromHtml & extractPriceFromHtml handle JSON-LD currency, 1P/3P hints, and negative context', () => {
  const html = `
    <html>
      <head>
        <title>Nike Air Force 1 '07 Alb - eMAG.ro</title>
        <script type="application/ld+json">
          {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": "Pantofi sport Nike Air Force 1 '07",
            "brand": { "@type": "Brand", "name": "Nike" },
            "gtin13": "0194500874212",
            "mpn": "CW2288-111",
            "offers": [
              { "@type": "Offer", "price": "120.00", "priceCurrency": "EUR", "availability": "https://schema.org/InStock" },
              { "@type": "Offer", "price": "549,99", "priceCurrency": "RON", "availability": "https://schema.org/InStock" }
            ]
          }
        </script>
      </head>
      <body>
        <div class="seller-name">Vândut și livrat de: eMAG</div>
        <span class="badge-genius">Genius</span>
      </body>
    </html>
  `;
  const parsedUrl = new URL('https://www.emag.ro/pantofi-nike/pd/D12345/');
  const meta = extractMetadataFromHtml(html, parsedUrl);
  assert.equal(meta.title, "Pantofi sport Nike Air Force 1 '07");
  assert.equal(meta.brand, 'Nike');
  assert.equal(meta.gtin, '0194500874212');
  assert.equal(meta.mpn, 'CW2288-111');
  assert.equal(meta.price, 549.99);
  assert.equal(meta.sellerType, '1p');
  assert.equal(meta.isGeniusEligible, true);

  // Reject EUR-only JSON-LD + reject +-40 char negative context (transport / rate / voucher / minim)
  const negContextHtml = `
    <html>
      <head>
        <script type="application/ld+json">
          { "@type": "Product", "name": "Produs Test", "offers": { "price": "99", "priceCurrency": "EUR" } }
        </script>
      </head>
      <body>
        <p>Livrare gratuită la comenzi peste 250,00 lei prin curier.</p>
        <p>Sau în 12 rate de 45,00 lei lunar fără dobândă.</p>
        <p>Transport easybox de la 14,99 lei.</p>
        <div class="final">Preț produs: 1.299,90 lei</div>
      </body>
    </html>
  `;
  const price = extractPriceFromHtml(negContextHtml, new URL('https://www.example.ro/p/1'));
  assert.equal(price, 1299.9);
  assert.equal(parseRoPrice('1.299,90 lei'), 1299.9);
  assert.equal(parseRoPrice('89,90'), 89.9);
  assert.equal(parseRoPrice('0 lei'), null);
});

test('extractStockAndSizesFromHtml: JSON-LD variants, Magento spConfig, scoped DOM (>=2 tokens), and truthful fail-closed fallback', () => {
  // 1. JSON-LD ProductGroup
  const jsonLdHtml = `
    <html><head>
      <script type="application/ld+json">
        {
          "@type": "ProductGroup",
          "name": "Nike Dunk Low",
          "hasVariant": [
            { "@type": "Product", "size": "41", "offers": { "price": "599", "priceCurrency": "RON", "availability": "https://schema.org/OutOfStock" } },
            { "@type": "Product", "size": "42", "offers": { "price": "599", "priceCurrency": "RON", "availability": "https://schema.org/InStock" } },
            { "@type": "Product", "size": "43", "offers": { "price": "599", "priceCurrency": "RON", "availability": "https://schema.org/InStock" } }
          ]
        }
      </script>
    </head><body></body></html>
  `;
  const s1 = extractStockAndSizesFromHtml(jsonLdHtml, 'https://shop.ro/p', 'shoes', '42');
  assert.equal(s1.verificationState, 'verified_in_stock');
  assert.equal(s1.hasDesiredSize, true);
  assert.deepEqual(s1.availableSizes, ['42', '43']);

  const s1Miss = extractStockAndSizesFromHtml(jsonLdHtml, 'https://shop.ro/p', 'shoes', '41');
  assert.equal(s1Miss.verificationState, 'verified_out_of_stock');
  assert.equal(s1Miss.hasDesiredSize, false);

  // 2. Magento text/x-magento-init spConfig
  const magentoHtml = `
    <html><body>
      <script type="text/x-magento-init">
        {
          "[data-role=swatch-options]": {
            "Magento_Swatches/js/swatch-renderer": {
              "jsonConfig": {
                "attributes": {
                  "145": {
                    "code": "size",
                    "label": "Mărime",
                    "options": [
                      { "id": "1", "label": "S", "products": ["101"] },
                      { "id": "2", "label": "M", "products": ["102"] },
                      { "id": "3", "label": "L", "products": ["103"], "in_stock": false },
                      { "id": "4", "label": "XL", "products": [] }
                    ]
                  }
                },
                "salable": {
                  "101": true,
                  "102": true,
                  "103": false
                }
              }
            }
          }
        }
      </script>
    </body></html>
  `;
  const s2 = extractStockAndSizesFromHtml(magentoHtml, 'https://gymbeam.ro/hanorac.html', 'clothes', 'M');
  assert.equal(s2.verificationState, 'verified_in_stock');
  assert.equal(s2.hasDesiredSize, true);
  assert.deepEqual(s2.availableSizes, ['S', 'M']);

  const s2Oos = extractStockAndSizesFromHtml(magentoHtml, 'https://gymbeam.ro/hanorac.html', 'clothes', 'L');
  assert.equal(s2Oos.verificationState, 'verified_out_of_stock');
  assert.equal(s2Oos.hasDesiredSize, false);

  // 3. Scoped DOM container respecting disabled/aria-disabled/.oos/.epuizat and >=2 tokens
  const domHtml = `
    <html><body>
      <div>Random badge >42< should NOT be matched outside size container</div>
      <div class="size-selector">
        <button data-size="40">40</button>
        <button data-size="41" disabled>41</button>
        <button data-size="42" class="oos">42</button>
        <button data-size="43" aria-disabled="true">43</button>
        <button data-size="44" data-available="false">44</button>
        <button data-size="45" class="epuizat">45</button>
        <button data-size="46">46</button>
      </div>
    </body></html>
  `;
  const s3In = extractStockAndSizesFromHtml(domHtml, 'https://sportisimo.ro/shoe', 'shoes', '40');
  assert.equal(s3In.verificationState, 'verified_in_stock');
  assert.equal(s3In.hasDesiredSize, true);
  assert.deepEqual(s3In.availableSizes, ['40', '46']);

  const s3Oos = extractStockAndSizesFromHtml(domHtml, 'https://sportisimo.ro/shoe', 'shoes', '42');
  assert.equal(s3Oos.verificationState, 'verified_out_of_stock');
  assert.equal(s3Oos.hasDesiredSize, false);

  // Single stray token in a container must NOT count as verified (>=2 tokens required)
  const singleTokenHtml = `<div class="size-selector"><span>42</span></div>`;
  const sSingle = extractStockAndSizesFromHtml(singleTokenHtml, 'https://shop.ro/p', 'shoes', '42');
  assert.equal(sSingle.verificationState, 'unverified_unknown');
  assert.equal(sSingle.hasDesiredSize, null);
  assert.equal(sSingle.isVerified, false);

  // Missing / failed HTML must NEVER return hasDesiredSize: true
  const sFail = extractStockAndSizesFromHtml('', 'https://shop.ro/p', 'shoes', '42');
  assert.equal(sFail.verificationState, 'unverified_unknown');
  assert.equal(sFail.hasDesiredSize, null);
  assert.notEqual(sFail.hasDesiredSize, true);

  // 4. __NEXT_DATA__ hydration JSON
  const nextHtml = `
    <html><body>
      <script id="__NEXT_DATA__" type="application/json">
        {"props":{"pageProps":{"product":{"variants":[{"size":"41","inStock":false},{"size":"42","inStock":true},{"size":"43","inStock":true}]}}}}
      </script>
    </body></html>
  `;
  const sNext = extractStockAndSizesFromHtml(nextHtml, 'https://footshop.ro/p', 'shoes', '42');
  assert.equal(sNext.verificationState, 'verified_in_stock');
  assert.equal(sNext.hasDesiredSize, true);
  assert.deepEqual(sNext.availableSizes, ['42', '43']);
});

test('extractStockAndSizesFromHtml reads eMAG embedded size characteristics', () => {
  // eMAG family/color pages expose every size in an embedded JS object whose
  // inner characteristics array is strict JSON (unquoted keys only outside it).
  const emagHtml = `<html><body><script>
    EM.product = { id: 117097961, offer: { id: 329147473 }, name: "Air Max Plus",
      "characteristics": [{"id":6506,"name":"Marime","products":[
        {"label":"36","is_available":true,"may_be_ordered":true,"price":{"current":719}},
        {"label":"37.5","is_available":true,"may_be_ordered":true,"price":{"current":719}},
        {"label":"38","is_available":false,"may_be_ordered":false,"price":{"current":1189}}
      ]}],
      missing_characteristic_names: ["Marime"] };
  </script></body></html>`;

  const inStock = extractStockAndSizesFromHtml(emagHtml, 'https://www.emag.ro/p', 'shoes', '36');
  assert.equal(inStock.verificationState, 'verified_in_stock');
  assert.equal(inStock.hasDesiredSize, true);
  assert.deepEqual(inStock.availableSizes, ['36', '37.5']);
  assert.ok(inStock.label.includes('36'));

  const outOfStock = extractStockAndSizesFromHtml(emagHtml, 'https://www.emag.ro/p', 'shoes', '38');
  assert.equal(outOfStock.verificationState, 'verified_out_of_stock');
  assert.equal(outOfStock.hasDesiredSize, false);
});

// --- 3. Platform Adapters & Serper Stage-1-only tests ---

test('altex_fenrir, magento2_graphql, shopify_suggest, vtex_search, emag_html, and cheerio_catalog fixtures', async () => {
  const altexStore = resolveStore('altex');
  const altexOffers = parseAltexFenrirResponse({
    products: [
      { name: 'Telefon Apple iPhone 15 128GB Black', price: 3699.9, url_key: 'telefon-apple-iphone-15-128gb', sku: 'SMTAPP15128BK', is_in_stock: true, ean: '195949035944' },
      { name: 'Telefon Resigilat Test', price: 0, url_key: 'bad', sku: 'BAD', is_in_stock: false },
    ],
  }, altexStore);
  assert.equal(altexOffers.length, 1);
  assert.equal(altexOffers[0].price, 3699.9);
  assert.equal(altexOffers[0].gtin, '195949035944');
  assert.equal(altexOffers[0].url, 'https://altex.ro/telefon-apple-iphone-15-128gb/cpd/SMTAPP15128BK/');

  // Magento2 GraphQL keeps clean GraphQL price (never overwritten by HTML regex)
  const gymbeamStore = resolveStore('gymbeam');
  const gbOffers = parseMagento2GraphqlResponse({
    data: {
      products: {
        items: [
          {
            name: 'True Whey 1000 g - GymBeam',
            sku: 'GB-TW-1000',
            url_key: 'true-whey-1000-g',
            stock_status: 'IN_STOCK',
            price_range: { minimum_price: { final_price: { value: 119.9, currency: 'RON' } } },
          },
        ],
      },
    },
  }, gymbeamStore);
  assert.equal(gbOffers.length, 1);
  assert.equal(gbOffers[0].price, 119.9);
  assert.equal(gbOffers[0].url, 'https://gymbeam.ro/true-whey-1000-g.html');
  assert.equal(gbOffers[0].inStock, true);

  // Shopify suggest.json
  const shopifyStore = {
    id: 'test_shopify',
    name: 'Test Shopify RO',
    domains: ['testshopify.ro'],
    businessModel: '1p',
    ingestion: { scraperConfig: { baseUrl: 'https://testshopify.ro' } },
  };
  const shopOffers = parseShopifySuggestResponse({
    resources: {
      results: {
        products: [
          { id: 123, title: 'Creatina Monohidrata 500g', url: '/products/creatina-500g?variant=9', price: '89.90', available: true },
        ],
      },
    },
  }, shopifyStore);
  assert.equal(shopOffers.length, 1);
  assert.equal(shopOffers[0].price, 89.9);
  assert.equal(shopOffers[0].url, 'https://testshopify.ro/products/creatina-500g?variant=9');

  // VTEX search
  const vtexStore = {
    id: 'test_vtex',
    name: 'Test VTEX RO',
    domains: ['testvtex.ro'],
    businessModel: '1p',
    ingestion: { scraperConfig: { baseUrl: 'https://testvtex.ro' } },
  };
  const vtexOffers = parseVtexSearchResponse([
    {
      productId: '44',
      productName: 'Adidas Ultraboost Light',
      link: 'https://testvtex.ro/adidas-ultraboost-light/p',
      items: [
        {
          ean: '4066751000011',
          sellers: [{ commertialOffer: { Price: 649.99, AvailableQuantity: 5, IsAvailable: true } }],
        },
      ],
    },
  ], vtexStore);
  assert.equal(vtexOffers.length, 1);
  assert.equal(vtexOffers[0].price, 649.99);
  assert.equal(vtexOffers[0].gtin, '4066751000011');

  // eMAG HTML card parsing with 1P/3P and Genius detection
  const emagStore = resolveStore('emag');
  const emagHtml = `
    <div class="card-item" data-name="Apple iPhone 15 128GB Black">
      <a class="card-v2-title" href="https://www.emag.ro/telefon-apple-iphone-15/pd/D11111/">Apple iPhone 15 128GB</a>
      <span class="badge-genius">Genius</span>
      <p class="product-new-price">3.499<sup>99</sup> lei</p>
      <span>Vândut și livrat de eMAG</span>
    </div>
    <div class="card-item" data-name="Apple iPhone 15 128GB">
      <a class="card-v2-title" href="https://www.emag.ro/telefon-apple-iphone-15/pd/D22222/">Apple iPhone 15 128GB</a>
      <p class="product-new-price">3.550<sup>00</sup> lei</p>
      <span>Vândut de: GSM Partner SRL</span>
    </div>
  `;
  const emagOffers = parseEmagHtml(emagHtml, emagStore);
  assert.equal(emagOffers.length, 2);
  assert.equal(emagOffers[0].price, 3499.99);
  assert.equal(emagOffers[0].marketplace.sellerType, '1p');
  assert.equal(emagOffers[0].marketplace.isGeniusEligible, true);
  assert.equal(emagOffers[1].marketplace.sellerType, '3p');
  assert.equal(emagOffers[1].marketplace.sellerName, 'GSM Partner SRL');
  assert.equal(emagOffers[1].marketplace.isGeniusEligible, null);

  // cheerio_catalog declarative parser
  const evomagStore = resolveStore('evomag');
  const evomagHtml = `
    <div class="nice_product_container">
      <div class="npi_name"><a href="/telefoane/apple-iphone-15-128gb.html">Telefon Mobil Apple iPhone 15 128GB</a></div>
      <div class="real_price">3.599,00 Lei</div>
    </div>
  `;
  const evoOffers = parseCheerioCatalogHtml(evomagHtml, evomagStore);
  assert.equal(evoOffers.length, 1);
  assert.equal(evoOffers[0].price, 3599);
  assert.equal(evoOffers[0].url, 'https://www.evomag.ro/telefoane/apple-iphone-15-128gb.html');
});

test('runStoreAdapters handles WAF bot_blocked circuit cleanly and searchSerperShoppingRo is Stage-1-only', async () => {
  circuitBreaker.reset();

  const mockFetch = async (storeId, url) => {
    if (storeId === 'emag') {
      circuitBreaker.recordFailure('emag', 'bot_blocked', 'Cloudflare 403');
      return { ok: false, status: 403, text: 'cf-mitigated', botBlocked: true };
    }
    if (storeId === 'altex') {
      return {
        ok: true,
        status: 200,
        json: {
          products: [
            { name: 'Apple iPhone 15 128GB', price: 3699, url_key: 'iphone-15-128gb', sku: 'IP15', is_in_stock: true },
          ],
        },
      };
    }
    return { ok: true, status: 200, text: '<html></html>', json: {} };
  };

  const res = await runStoreAdapters('iPhone 15 128GB', 'electronics', {
    storeIds: ['emag', 'altex'],
    fetchFn: mockFetch,
  });

  assert.equal(res.matches.length, 1);
  assert.equal(res.matches[0].storeId, 'altex');
  assert.equal(circuitBreaker.getStoreHealth('emag').lastFailureKind, 'bot_blocked');
  circuitBreaker.reset();

  // Serper Stage 1 MUST NOT perform HTML fetches for price-less organic results
  let fetchCalls = 0;
  const mockSerperFetch = async (url) => {
    fetchCalls++;
    if (url.includes('/shopping')) {
      return {
        ok: true,
        status: 200,
        json: {
          shopping: [
            { title: 'Nike Air Force 1 07', source: 'Fashion Days', link: 'https://www.fashiondays.ro/p/nike-123', price: '499,99 lei' },
            { title: 'Bad SSRF URL', source: 'Evil', link: 'http://127.0.0.1/steal', price: '10 lei' },
          ],
        },
      };
    }
    if (url.includes('/search')) {
      return {
        ok: true,
        status: 200,
        json: {
          organic: [
            { title: 'Nike Air Force 1 07 Alb', link: 'https://www.sportisimo.ro/nike-af1', snippet: 'Disponibil acum' },
          ],
        },
      };
    }
    throw new Error(`Unexpected Stage 1 HTML fetch to ${url}`);
  };

  const serperRes = await searchSerperShoppingRo('Nike Air Force 1', 'test-key', { fetchFn: mockSerperFetch });
  assert.equal(fetchCalls, 2); // ONLY /shopping and /search, ZERO Stage 1 HTML fetches!
  assert.equal(serperRes.matches.length, 2);
  assert.equal(serperRes.matches[0].price, 499.99);
  assert.equal(serperRes.matches[1].url, 'https://www.sportisimo.ro/nike-af1');
  assert.equal(serperRes.matches[1].price, null);
  assert.equal(serperRes.matches[1].needsPriceEnrichment, true);
});
