const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { createAppServer, SECURITY_HEADERS } = require('../server');

function requestHttp(server, method, reqPath, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const opts = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: reqPath,
      method,
      headers: { ...headers },
    };
    let payload = null;
    if (body !== null) {
      payload = typeof body === 'string' ? body : JSON.stringify(body);
      if (!opts.headers['Content-Type']) opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request(opts, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

test('HTTP routes, security headers, static containment, and /api/stores payload', async (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-api-test-'));
  const pubDir = path.join(tmpRoot, 'public');
  const secretDir = path.join(tmpRoot, 'public-secret');
  fs.mkdirSync(pubDir, { recursive: true });
  fs.mkdirSync(secretDir, { recursive: true });
  fs.writeFileSync(path.join(pubDir, 'index.html'), '<h1>FrugalRadar</h1>');
  fs.writeFileSync(path.join(secretDir, 'leak.txt'), 'SECRET_DATA');

  const outsideFile = path.join(tmpRoot, 'outside.txt');
  fs.writeFileSync(outsideFile, 'OUTSIDE');
  const symlinkPath = path.join(pubDir, 'escape.txt');
  let symlinkCreated = false;
  try {
    fs.symlinkSync(outsideFile, symlinkPath);
    symlinkCreated = true;
  } catch {
    // Windows without Developer Mode may disallow symlinks
  }

  let capturedSearchParams = null;
  let capturedIdentifyFetch = null;

  const mockServer = createAppServer({
    publicDir: pubDir,
    getPublicStoresSummary: () => ({
      total: 35,
      membershipPrograms: [{ id: 'emag_genius', name: 'eMAG Genius' }],
      stores: [
        {
          id: 'altex',
          name: 'Altex',
          domains: ['altex.ro'],
          vertical: 'electronics',
          categories: ['electronics'],
          businessModel: 'marketplace_hybrid',
          shippingSummary: { freeThreshold: 400 },
          returns: { days: 14 },
          ingestion: { tier: 2, liveVerifyCapable: true },
          health: { state: 'healthy' },
        },
      ],
    }),
    runSearchPipeline: async (params) => {
      capturedSearchParams = params;
      return {
        query: params.query,
        detectedCategory: 'electronics',
        desiredSize: '',
        totalStoresChecked: 1,
        totalOffersFound: 1,
        inStockCount: 1,
        offers: [{ storeId: 'altex', totalCost: 3500 }],
        otherVariantOffers: [],
        manualStores: [],
        storeHealth: [],
        cacheStatus: 'miss',
        cachedAt: Date.now(),
        sourceComparison: null,
        serperInfo: { used: Boolean(params.serperKey), shoppingCount: 0, webCount: 0, error: null },
      };
    },
    checkStockBatch: async ({ urls, category, desiredSize }) => ({
      results: urls.map((url) => ({
        url,
        stock: { requiresSize: category === 'shoes', verificationState: 'unverified_unknown', hasDesiredSize: null, desiredSize },
      })),
    }),
    analyzeProductUrl: async (rawUrl) => ({
      title: 'Apple iPhone 15 128GB Black',
      distilledQuery: 'Apple iPhone 15 128GB',
      image: '',
      price: 3499,
      brand: 'Apple',
      gtin: null,
      mpn: null,
      storeId: 'altex',
      domain: 'altex.ro',
      detectedCategory: 'electronics',
      scrapedLive: true,
      sourceOffer: { url: rawUrl, storeId: 'altex', price: 3499 },
    }),
    safeFetch: async (url, opts) => {
      capturedIdentifyFetch = { url, opts };
      return {
        ok: true,
        status: 200,
        json: {
          candidates: [{ content: { parts: [{ text: '{"query":"Nike Air Force 1 07","category":"shoes"}' }] } }],
        },
      };
    },
  });

  await new Promise((resolve) => mockServer.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => mockServer.close(resolve));
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 1. Security headers + index.html
  const rootRes = await requestHttp(mockServer, 'GET', '/');
  assert.equal(rootRes.status, 200);
  assert.match(rootRes.text, /FrugalRadar/);
  assert.equal(rootRes.headers['content-security-policy'], SECURITY_HEADERS['Content-Security-Policy']);
  assert.equal(rootRes.headers['x-content-type-options'], 'nosniff');
  assert.equal(rootRes.headers['referrer-policy'], 'no-referrer');

  // 2. Path traversal & sibling prefix rejection
  const trav1 = await requestHttp(mockServer, 'GET', '/../public-secret/leak.txt');
  assert.equal(trav1.status, 403);
  const travEncoded = await requestHttp(mockServer, 'GET', '/..%2fpublic-secret%2fleak.txt');
  assert.equal(travEncoded.status, 403);
  const trav2 = await requestHttp(mockServer, 'GET', '/%2e%2e/outside.txt');
  assert.equal(trav2.status, 403);
  const badDecode = await requestHttp(mockServer, 'GET', '/%E0%A4%A');
  assert.equal(badDecode.status, 400);
  if (symlinkCreated) {
    const symRes = await requestHttp(mockServer, 'GET', '/escape.txt');
    assert.equal(symRes.status, 403);
  }

  // 3. GET /api/stores payload
  const storesRes = await requestHttp(mockServer, 'GET', '/api/stores');
  assert.equal(storesRes.status, 200);
  assert.equal(storesRes.json.total, 35);
  assert.ok(Array.isArray(storesRes.json.stores));
  assert.equal(storesRes.json.stores[0].id, 'altex');

  // 4. POST /api/search reads X-Serper-Key header
  const searchRes = await requestHttp(mockServer, 'POST', '/api/search', {
    headers: { 'X-Serper-Key': 'test-serper-header-key' },
    body: { query: 'iPhone 15 128GB', category: 'electronics' },
  });
  assert.equal(searchRes.status, 200);
  assert.equal(capturedSearchParams.serperKey, 'test-serper-header-key');
  assert.equal(searchRes.json.totalStoresChecked, 1);

  // 5. POST /api/check-stock & POST /api/analyze-url
  const stockRes = await requestHttp(mockServer, 'POST', '/api/check-stock', {
    body: { urls: ['https://altex.ro/produs/cpd/123/'], category: 'shoes', desiredSize: '42' },
  });
  assert.equal(stockRes.status, 200);
  assert.equal(stockRes.json.results.length, 1);
  assert.equal(stockRes.json.results[0].stock.verificationState, 'unverified_unknown');

  const analyzeRes = await requestHttp(mockServer, 'POST', '/api/analyze-url', {
    body: { url: 'https://altex.ro/iphone-15/cpd/123/' },
  });
  assert.equal(analyzeRes.status, 200);
  assert.equal(analyzeRes.json.distilledQuery, 'Apple iPhone 15 128GB');

  // 6. POST /api/identify-image validation + x-goog-api-key header proxy
  const badMime = await requestHttp(mockServer, 'POST', '/api/identify-image', {
    headers: { 'X-Gemini-Key': 'AIzaTest' },
    body: { mimeType: 'image/svg+xml', base64: Buffer.from('<svg/>').toString('base64') },
  });
  assert.equal(badMime.status, 400);

  const bigBase64 = Buffer.alloc(4 * 1024 * 1024 + 100, 1).toString('base64');
  const tooBig = await requestHttp(mockServer, 'POST', '/api/identify-image', {
    headers: { 'X-Gemini-Key': 'AIzaTest' },
    body: { mimeType: 'image/png', base64: bigBase64 },
  });
  assert.equal(tooBig.status, 413);

  const goodImg = await requestHttp(mockServer, 'POST', '/api/identify-image', {
    headers: { 'X-Gemini-Key': 'AIzaTestKey123' },
    body: { mimeType: 'image/png', base64: Buffer.from('fake-png-bytes').toString('base64') },
  });
  assert.equal(goodImg.status, 200);
  assert.equal(goodImg.json.query, 'Nike Air Force 1 07');
  assert.equal(goodImg.json.category, 'shoes');
  assert.ok(!capturedIdentifyFetch.url.includes('AIzaTestKey123'), 'API key must NOT be in URL');
  assert.equal(capturedIdentifyFetch.opts.headers['x-goog-api-key'], 'AIzaTestKey123');
});

test('Real createAppServer /api/stores + runSearchPipeline Stage 1/2 + checkStockBatch + analyzeProductUrl', async (t) => {
  const { runSearchPipeline, checkStockBatch, analyzeProductUrl } = require('../lib/search-pipeline');
  const { createCache } = require('../lib/cache');
  const { circuitBreaker } = require('../lib/http-client');

  circuitBreaker.reset();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fr-pipe-test-'));
  const testCache = createCache({ dbPath: path.join(tmpDir, 'test.sqlite') });

  const realServer = createAppServer();
  await new Promise((resolve) => realServer.listen(0, '127.0.0.1', resolve));

  t.after(async () => {
    await new Promise((resolve) => realServer.close(resolve));
    testCache.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    circuitBreaker.reset();
  });

  // Real GET /api/stores
  const storesRes = await requestHttp(realServer, 'GET', '/api/stores');
  assert.equal(storesRes.status, 200);
  assert.ok(storesRes.json.total >= 34, `Expected >=34 stores, got ${storesRes.json.total}`);
  assert.ok(storesRes.json.stores.some((s) => s.id === 'altex'));
  assert.ok(storesRes.json.stores.some((s) => s.id === 'gymbeam'));

  // runSearchPipeline with mocked adapters/serper/storeFetch exercising dedup, variant bucketing, Stage 2 breadth-first enrichment, cost math, and manualStores
  const pipelineRes = await runSearchPipeline(
    {
      query: 'Whey Protein 2kg',
      category: 'supplements',
      deliveryType: 'easybox',
      paymentMethod: 'card',
      sourceOffer: {
        url: 'https://www.notino.ro/p-99999/',
        storeId: 'notino',
        price: 290,
        title: 'Whey Protein 2kg',
      },
    },
    {
      cache: testCache,
      runStoreAdapters: async () => ({
        cacheStatus: 'miss',
        cachedAt: Date.now(),
        matches: [
          {
            storeId: 'gymbeam',
            title: 'True Whey Protein 2kg',
            url: 'https://gymbeam.ro/true-whey-protein.html?utm_source=test',
            price: 179.9,
            inStock: true,
            priceSource: 'tier2_live',
          },
          {
            storeId: 'gymbeam',
            title: 'True Whey Protein 500g',
            url: 'https://gymbeam.ro/true-whey-protein-500g.html',
            price: 59.9,
            inStock: true,
            priceSource: 'tier2_live',
          },
        ],
      }),
      searchSerperShoppingRo: async () => ({
        cacheStatus: 'miss',
        cachedAt: Date.now(),
        info: { used: true, shoppingCount: 1, webCount: 1, error: null },
        matches: [
          {
            storeId: null,
            customStoreName: 'GymBeam.ro',
            title: 'True Whey Protein 2kg',
            url: 'https://gymbeam.ro/true-whey-protein.html?fbclid=123',
            price: 185,
            inStock: true,
            priceSource: 'tier3_serper',
          },
          {
            storeId: null,
            customStoreName: 'Protein4Life',
            title: 'Impact Whey Protein 2kg',
            url: 'https://www.protein4life.ro/impact-whey-protein-2kg',
            price: null,
            needsPriceEnrichment: true,
            inStock: true,
            priceSource: 'tier3_serper',
          },
        ],
      }),
      storeFetch: async (_storeId, rawUrl) => {
        if (rawUrl.includes('protein4life.ro')) {
          return {
            ok: true,
            status: 200,
            finalUrl: rawUrl,
            text: '<html><script type="application/ld+json">{"@type":"Product","name":"Impact Whey Protein 2kg","offers":{"@type":"Offer","price":"165.00","priceCurrency":"RON","availability":"https://schema.org/InStock"}}</script></html>',
          };
        }
        return { ok: false, status: 404, text: '' };
      },
    }
  );

  assert.equal(pipelineRes.detectedCategory, 'supplements');
  assert.equal(pipelineRes.offers.length, 2); // gymbeam 2kg (deduped) + protein4life 2kg (Stage 2 enriched)
  assert.equal(pipelineRes.otherVariantOffers.length, 1); // 500g bucketed separately
  assert.equal(pipelineRes.offers[0].storeId, 'protein4life'); // 165 + 14.99 = 179.99 < 179.9 + 11.9 = 191.8
  assert.equal(pipelineRes.offers[1].storeId, 'gymbeam');
  assert.equal(pipelineRes.offers[1].price, 179.9); // quality-preserving dedup kept tier2_live price over serper 185
  assert.ok(pipelineRes.sourceComparison && pipelineRes.sourceComparison.savingsVsSource > 0);
  // Manual stores must NOT bleed unrelated 'electronics' / 'diy_home' stores like dedeman
  assert.ok(!pipelineRes.manualStores.some((ms) => ms.storeId === 'dedeman'));

  // checkStockBatch updates sizes truthfully for liveVerifyCapable stores and skips WAF-blocked stores
  const stockBatch = await checkStockBatch(
    {
      urls: [
        'https://www.sportisimo.ro/nike/air-force-1-07/12345/',
        'https://www.zalando.ro/nike-air-force-1-07.html',
      ],
      category: 'shoes',
      desiredSize: '42',
    },
    {
      cache: testCache,
      storeFetch: async (_sid, u) => ({
        ok: true,
        status: 200,
        finalUrl: u,
        text: '<div class="size-selector"><button data-size="41">41</button><button data-size="42">42</button><button data-size="43" disabled>43</button></div>',
      }),
    }
  );
  assert.equal(stockBatch.results[0].stock.verificationState, 'verified_in_stock');
  assert.equal(stockBatch.results[0].stock.hasDesiredSize, true);
  assert.equal(stockBatch.results[1].stock.verificationState, 'unverified_unknown');
  assert.equal(stockBatch.results[1].stock.hasDesiredSize, null);

  // analyzeProductUrl distills query & builds sourceOffer
  const analyzed = await analyzeProductUrl('https://altex.ro/telefon-apple-iphone-15-128gb-5g-black/cpd/MOBIP15128BK/', {
    cache: testCache,
    storeFetch: async (_sid, u) => ({
      ok: true,
      status: 200,
      finalUrl: u,
      text: '<html><head><title>Telefon mobil Apple iPhone 15 128GB 5G Black - Altex</title><meta property="product:price:amount" content="3.499,00"><meta property="product:price:currency" content="RON"></head></html>',
    }),
  });
  assert.equal(analyzed.storeId, 'altex');
  assert.equal(analyzed.price, 3499);
  assert.equal(analyzed.detectedCategory, 'electronics');
  assert.ok(analyzed.distilledQuery.toLowerCase().includes('iphone'));
  assert.equal(analyzed.sourceOffer.price, 3499);
});
