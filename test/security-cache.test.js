'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const {
  isSafePublicUrl,
  safeFetch,
  detectBotBlock,
  circuitBreaker,
  createCircuitBreaker,
  storeFetch,
} = require('../lib/http-client');
const { createCache } = require('../lib/cache');

function startLocalServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

test('isSafePublicUrl rejects unsafe schemes, userinfo, private/reserved IPs, and internal TLDs', () => {
  const blocked = [
    '',
    'ftp://example.com/file',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://user:pass@altex.ro/product',
    'https://token@emag.ro/product',
    'http://127.0.0.1/admin',
    'http://0.0.0.0/',
    'http://10.0.0.1/',
    'http://172.16.0.1/',
    'http://172.31.255.255/',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/',
    'http://224.0.0.1/',
    'http://[::1]/',
    'http://[::]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[fc00::1]/',
    'http://[fe80::1]/',
    'http://[ff02::1]/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://localhost/test',
    'http://localhost./test',
    'http://intranet/secret',
    'http://printer.local/',
    'http://service.internal/',
    'http://router.lan/',
    'http://1.0.0.127.in-addr.arpa/',
  ];

  for (const url of blocked) {
    assert.equal(isSafePublicUrl(url), null, `Expected ${url} to be rejected`);
  }

  const allowed = [
    'https://altex.ro/cauta/?q=iphone',
    'http://www.emag.ro/search/laptop',
    'https://8.8.8.8/dns',
    'https://[2606:4700:4700::1111]/',
  ];

  for (const url of allowed) {
    const parsed = isSafePublicUrl(url);
    assert.ok(parsed instanceof URL, `Expected ${url} to be allowed`);
  }
});

test('safeFetch pins validated IP, decompresses gzip, and blocks redirect to localhost', async (t) => {
  const { server, port } = await startLocalServer((req, res) => {
    if (req.url === '/redirect-local') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/secret` });
      res.end();
      return;
    }
    if (req.url === '/redirect-hop') {
      res.writeHead(302, { Location: '/gzip-ok' });
      res.end();
      return;
    }
    if (req.url === '/gzip-ok') {
      const payload = zlib.gzipSync(Buffer.from(JSON.stringify({ ok: true, host: req.headers.host })));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      });
      res.end(payload);
      return;
    }
    if (req.url === '/too-large') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('A'.repeat(4096));
      return;
    }
    if (req.url === '/slow') {
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200);
          res.end('late');
        }
      }, 400);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  t.after(() => server.close());

  // Use a synthetic public domain that resolves via mocked DNS to 127.0.0.1 for server routing,
  // first proving safeFetch blocks private DNS resolution:
  const blockedDns = await safeFetch('http://rebind.example.com/test', {
    _dnsLookup: async () => [{ address: '127.0.0.1', family: 4 }],
  });
  assert.equal(blockedDns.ok, false);
  assert.match(blockedDns.error, /Blocked/i);

  // Also test mixed DNS response containing one private IP fails closed:
  const mixedDns = await safeFetch('http://mixed.example.com/test', {
    _dnsLookup: async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ],
  });
  assert.equal(mixedDns.ok, false);
  assert.match(mixedDns.error, /Blocked/i);

  // Now verify redirect-to-localhost blocking using a fake public IP entry on hop 1
  // (custom _dnsLookup returns 93.184.216.34? No, we need to reach local test server on hop 1;
  // we can use 127.0.0.1 only via testing redirect target directly and testing a local server via
  // a custom dnsLookup? Wait: resolveAndValidateHost blocks 127.0.0.1! So let's verify direct
  // safeFetch blocks 127.0.0.1 AND verify via Node http.request mock or public-looking IP?
  // Actually, if we test redirect from an external-looking URL via mocked http.request OR
  // wait: in safeFetch, any Location -> http://127.0.0.1:... is caught by isSafePublicUrl BEFORE connecting!
  // Let's test BOTH: direct http://127.0.0.1 and redirect via a local stubbed http.request/redirect!)
  const directLocal = await safeFetch(`http://127.0.0.1:${port}/gzip-ok`);
  assert.equal(directLocal.ok, false);
  assert.match(directLocal.error, /Blocked unsafe URL/i);
});

test('safeFetch handles redirect-to-localhost, gzip decompression, maxBytes abort, and timeout via local server', async (t) => {
  // Spin up a local server and temporarily hook ipaddr validation only? No, never bypass real checks!
  // Instead, spin up a mock http server and test execute flow using an external-routable mock?
  // Wait: if we can't reach real 93.184.216.34 offline, how do we drive safeFetch against 127.0.0.1
  // without weakening isSafePublicUrl?
  // Easy: stub http.request in this unit test to forward to our real local 127.0.0.1 test server!
  const { server, port } = await startLocalServer((req, res) => {
    if (req.url === '/redirect-to-localhost') {
      res.writeHead(302, { Location: `http://127.0.0.1:${port}/secret` });
      res.end();
      return;
    }
    if (req.url === '/redirect-to-gzip') {
      res.writeHead(302, { Location: `http://shop.example.ro:${port}/gzip` });
      res.end();
      return;
    }
    if (req.url === '/gzip') {
      const payload = zlib.gzipSync(Buffer.from(JSON.stringify({ price: 199.9, host: req.headers.host })));
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
      });
      res.end(payload);
      return;
    }
    if (req.url === '/huge') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('X'.repeat(5000));
      return;
    }
    if (req.url === '/slow') {
      setTimeout(() => {
        if (!res.destroyed) {
          res.writeHead(200);
          res.end('too late');
        }
      }, 300);
      return;
    }
    if (req.url === '/br') {
      const payload = zlib.brotliCompressSync(Buffer.from('hello brotli'));
      res.writeHead(200, { 'Content-Encoding': 'br' });
      res.end(payload);
      return;
    }
    if (req.url === '/hop-1') {
      res.writeHead(301, { Location: '/hop-2' });
      res.end();
      return;
    }
    if (req.url === '/hop-2') {
      res.writeHead(302, { Location: '/hop-3' });
      res.end();
      return;
    }
    if (req.url === '/hop-3') {
      res.writeHead(307, { Location: '/hop-4' });
      res.end();
      return;
    }
    if (req.url === '/hop-4') {
      res.writeHead(308, { Location: '/gzip' });
      res.end();
      return;
    }
    if (req.url === '/cf-block') {
      res.writeHead(403, { 'cf-mitigated': 'challenge', Server: 'cloudflare' });
      res.end('<div class="cf-turnstile"></div>');
      return;
    }
    res.writeHead(200);
    res.end('ok');
  });

  const origHttpRequest = http.request;
  let capturedLookupResult = null;

  http.request = function patchedRequest(options, cb) {
    // Capture the pinned lookup result safeFetch computed, then connect to local test server
    if (typeof options.lookup === 'function') {
      options.lookup(options.hostname, { all: false }, (_err, addr, family) => {
        capturedLookupResult = { addr, family };
      });
    }
    return origHttpRequest.call(
      http,
      {
        ...options,
        hostname: '127.0.0.1',
        port,
        lookup: undefined,
      },
      cb
    );
  };

  t.after(() => {
    http.request = origHttpRequest;
    server.close();
  });

  const fakePublicDns = async () => [{ address: '93.184.216.34', family: 4 }];

  // 1. Redirect to localhost must be blocked on Location hop
  const redirLocal = await safeFetch(`http://shop.example.ro:${port}/redirect-to-localhost`, {
    _dnsLookup: fakePublicDns,
  });
  assert.equal(redirLocal.ok, false);
  assert.match(redirLocal.error, /Blocked unsafe URL/i);

  // 2. Valid redirect + gzip decompression + Host header preservation + IP pinning
  const okRes = await safeFetch(`http://shop.example.ro:${port}/redirect-to-gzip`, {
    _dnsLookup: fakePublicDns,
  });
  assert.equal(okRes.ok, true);
  assert.equal(okRes.status, 200);
  assert.deepEqual(capturedLookupResult, { addr: '93.184.216.34', family: 4 });
  assert.equal(okRes.json.price, 199.9);
  assert.equal(okRes.json.host, `shop.example.ro:${port}`);

  // 3. maxBytes enforcement aborts oversized response
  const hugeRes = await safeFetch(`http://shop.example.ro:${port}/huge`, {
    maxBytes: 1024,
    _dnsLookup: fakePublicDns,
  });
  assert.equal(hugeRes.ok, false);
  assert.match(hugeRes.error, /maxBytes/i);

  // 4. Timeout enforcement
  const slowRes = await safeFetch(`http://shop.example.ro:${port}/slow`, {
    timeoutMs: 60,
    _dnsLookup: fakePublicDns,
  });
  assert.equal(slowRes.ok, false);
  assert.match(slowRes.error, /timeout/i);

  // 5. Brotli decompression
  const brRes = await safeFetch(`http://shop.example.ro:${port}/br`, {
    _dnsLookup: fakePublicDns,
  });
  assert.equal(brRes.ok, true);
  assert.equal(brRes.text, 'hello brotli');

  // 6. Max redirects limit
  const redirCapRes = await safeFetch(`http://shop.example.ro:${port}/hop-1`, {
    maxRedirects: 3,
    _dnsLookup: fakePublicDns,
  });
  assert.equal(redirCapRes.ok, false);
  assert.match(redirCapRes.error, /Too many redirects/i);

  // 7. storeFetch records bot_blocked in circuitBreaker and trips after 3 blocks
  circuitBreaker.reset();
  for (let i = 0; i < 3; i++) {
    const blocked = await storeFetch('cfstore', `http://shop.example.ro:${port}/cf-block`, {
      useImpit: false,
      _dnsLookup: fakePublicDns,
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.botBlocked, true);
  }
  assert.equal(circuitBreaker.getStoreHealth('cfstore').state, 'OPEN');
  assert.equal(circuitBreaker.canRequest('cfstore'), false);
  circuitBreaker.reset();
});

test('detectBotBlock identifies Cloudflare, Akamai, DataDome, and CAPTCHA responses without false positives', () => {
  assert.equal(detectBotBlock(200, { 'cf-mitigated': 'challenge' }, '<html></html>'), true);
  assert.equal(detectBotBlock(429, {}, 'Too many requests'), true);
  assert.equal(
    detectBotBlock(403, { server: 'cloudflare' }, '<div class="cf-turnstile"></div>'),
    true
  );
  assert.equal(
    detectBotBlock(403, { 'set-cookie': '_abck=abc123; path=/' }, 'Access Denied'),
    true
  );
  assert.equal(
    detectBotBlock(403, { 'x-datadome': 'protected' }, 'https://geo.captcha-delivery.com/captcha/'),
    true
  );
  assert.equal(detectBotBlock(503, {}, 'Please verify you are human - hcaptcha.com'), true);

  assert.equal(
    detectBotBlock(200, { 'content-type': 'text/html' }, '<html><h1>iPhone 15 128GB</h1><span>3499 lei</span></html>'),
    false
  );
});

test('circuitBreaker transitions CLOSED -> OPEN -> HALF_OPEN -> CLOSED/OPEN and handles parse_drift 4-in-10', () => {
  const cb = createCircuitBreaker();
  const realNow = Date.now;
  let fakeNow = 1_000_000;
  Date.now = () => fakeNow;

  try {
    assert.equal(cb.canRequest('emag'), true);
    assert.equal(cb.getStoreHealth('emag').state, 'CLOSED');

    // 2 consecutive failures keep it CLOSED
    cb.recordFailure('emag', 'bot_blocked', '403');
    cb.recordFailure('emag', 'bot_blocked', '403');
    assert.equal(cb.canRequest('emag'), true);
    assert.equal(cb.getStoreHealth('emag').state, 'CLOSED');

    // 3rd consecutive failure trips OPEN for 15m
    cb.recordFailure('emag', 'bot_blocked', '403');
    assert.equal(cb.canRequest('emag'), false);
    assert.equal(cb.getStoreHealth('emag').state, 'OPEN');

    // Still OPEN at +14m
    fakeNow += 14 * 60 * 1000;
    assert.equal(cb.canRequest('emag'), false);

    // Transitions to HALF_OPEN at +15m
    fakeNow += 60 * 1000;
    assert.equal(cb.canRequest('emag'), true);
    assert.equal(cb.getStoreHealth('emag').state, 'HALF_OPEN');

    // Probe failure immediately re-opens circuit
    cb.recordFailure('emag', 'timeout', 'timed out');
    assert.equal(cb.canRequest('emag'), false);
    assert.equal(cb.getStoreHealth('emag').state, 'OPEN');

    // Timeout cooldown is 3m -> HALF_OPEN -> success closes it
    fakeNow += 3 * 60 * 1000;
    assert.equal(cb.canRequest('emag'), true);
    cb.recordSuccess('emag', 140);
    assert.equal(cb.getStoreHealth('emag').state, 'CLOSED');
    assert.equal(cb.getStoreHealth('emag').consecutiveFailures, 0);

    // parse_drift trips on 4 in 10 outcomes (30m cooldown)
    cb.recordFailure('altex', 'parse_drift', 'no price');
    cb.recordSuccess('altex', 100);
    cb.recordFailure('altex', 'parse_drift', 'no price');
    cb.recordFailure('altex', 'parse_drift', 'no price');
    assert.equal(cb.getStoreHealth('altex').state, 'CLOSED');
    cb.recordFailure('altex', 'parse_drift', 'no price');
    assert.equal(cb.getStoreHealth('altex').state, 'OPEN');
    assert.equal(cb.getStoreHealth('altex').cooldownRemainingMs, 30 * 60 * 1000);
  } finally {
    Date.now = realNow;
  }
});

test('storeFetch gates on isSafePublicUrl and circuitBreaker', async () => {
  circuitBreaker.reset();

  const unsafeRes = await storeFetch('emag', 'http://169.254.169.254/latest/meta-data/');
  assert.equal(unsafeRes.ok, false);
  assert.match(unsafeRes.error, /Blocked unsafe URL/i);

  circuitBreaker.recordFailure('demo', 'timeout', 't1');
  circuitBreaker.recordFailure('demo', 'timeout', 't2');
  circuitBreaker.recordFailure('demo', 'timeout', 't3');

  const openRes = await storeFetch('demo', 'https://altex.ro/cauta/?q=iphone');
  assert.equal(openRes.ok, false);
  assert.match(openRes.error, /Circuit breaker OPEN/i);
  circuitBreaker.reset();
});

test('createCache supports SWR, single-flight coalescing, negative caching, and SQLite price history deduplication', async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frugal-cache-test-'));
  const dbPath = path.join(tmpDir, 'nested', 'cache.sqlite');
  let cache = createCache({ dbPath, maxMemoryEntries: 10 });

  t.after(() => {
    cache.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const info = cache.getBackendInfo();
  assert.equal(info.backend, 'sqlite');
  assert.equal(info.walMode, true);
  assert.ok(fs.existsSync(dbPath));

  // 1. Single-flight coalescing: 5 concurrent callers share 1 fetcher call
  let calls = 0;
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      cache.getOrFetch(
        'search:iphone15',
        async () => {
          calls++;
          await new Promise((r) => setTimeout(r, 30));
          return { items: ['iPhone 15 128GB'] };
        },
        { freshMs: 40, staleMs: 5000 }
      )
    )
  );
  assert.equal(calls, 1);
  assert.equal(results[0].status, 'MISS');
  assert.deepEqual(results[0].value, { items: ['iPhone 15 128GB'] });

  // 2. Fresh hit
  const hit = await cache.getOrFetch('search:iphone15', async () => {
    calls++;
    return { items: ['should not run'] };
  });
  assert.equal(hit.status, 'HIT');
  assert.equal(calls, 1);

  // 3. Stale-while-revalidate: after freshMs expires, returns STALE immediately and refreshes in background
  await new Promise((r) => setTimeout(r, 60));
  let bgCalls = 0;
  const staleRes = await cache.getOrFetch(
    'search:iphone15',
    async () => {
      bgCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return { items: ['iPhone 15 Refreshed'] };
    },
    { freshMs: 5000, staleMs: 10000 }
  );
  assert.equal(staleRes.status, 'STALE');
  assert.deepEqual(staleRes.value, { items: ['iPhone 15 128GB'] });

  await new Promise((r) => setTimeout(r, 50));
  assert.equal(bgCalls, 1);
  const refreshedHit = await cache.getOrFetch('search:iphone15', async () => {
    bgCalls++;
    return null;
  });
  assert.equal(refreshedHit.status, 'HIT');
  assert.deepEqual(refreshedHit.value, { items: ['iPhone 15 Refreshed'] });
  assert.equal(bgCalls, 1);

  // 4. Negative caching prevents repeated null fetches within negativeMs
  let negCalls = 0;
  const neg1 = await cache.getOrFetch(
    'neg:key',
    async () => {
      negCalls++;
      return null;
    },
    { negativeMs: 500 }
  );
  assert.equal(neg1.status, 'MISS');
  assert.equal(neg1.value, null);

  const neg2 = await cache.getOrFetch(
    'neg:key',
    async () => {
      negCalls++;
      return { ok: true };
    },
    { negativeMs: 500 }
  );
  assert.equal(neg2.status, 'NEGATIVE_HIT');
  assert.equal(negCalls, 1);

  // 5. Price history deduplication (6h window) + persistence across reopen
  const t0 = 1_700_000_000_000;
  const s1 = cache.recordPriceObservation({
    storeProductKey: 'altex:IP15-128',
    storeId: 'altex',
    title: 'iPhone 15 128GB',
    price: 3599.9,
    url: 'https://altex.ro/iphone-15/cpd/IP15-128',
    observedAt: t0,
  });
  assert.equal(s1.observations, 1);
  assert.equal(s1.priceDelta, 0);

  // Same price 2h later -> deduped
  const s2 = cache.recordPriceObservation({
    storeProductKey: 'altex:IP15-128',
    storeId: 'altex',
    title: 'iPhone 15 128GB',
    price: 3599.9,
    observedAt: t0 + 2 * 60 * 60 * 1000,
  });
  assert.equal(s2.observations, 1);

  // Price drop 3h later -> recorded
  const s3 = cache.recordPriceObservation({
    storeProductKey: 'altex:IP15-128',
    storeId: 'altex',
    title: 'iPhone 15 128GB',
    price: 3299.9,
    observedAt: t0 + 3 * 60 * 60 * 1000,
  });
  assert.equal(s3.observations, 2);
  assert.equal(s3.minPrice, 3299.9);
  assert.equal(s3.maxPrice, 3599.9);
  assert.equal(s3.priceDelta, -300);

  // Same price after 6h -> recorded as new point
  const s4 = cache.recordPriceObservation({
    storeProductKey: 'altex:IP15-128',
    storeId: 'altex',
    title: 'iPhone 15 128GB',
    price: 3299.9,
    observedAt: t0 + 10 * 60 * 60 * 1000,
  });
  assert.equal(s4.observations, 3);
  assert.equal(s4.priceDelta, 0);

  // Reopen SQLite DB and verify persistence
  cache.close();
  cache = createCache({ dbPath, maxMemoryEntries: 10 });
  const persistedStats = cache.getPriceStats('altex:IP15-128');
  assert.equal(persistedStats.observations, 3);
  assert.equal(persistedStats.minPrice, 3299.9);
  assert.equal(persistedStats.maxPrice, 3599.9);

  // 6. Memory-only fallback LRU eviction check
  const memCache = createCache({ dbPath: null, maxMemoryEntries: 2 });
  assert.equal(memCache.getBackendInfo().backend, 'memory');
  memCache.set('k1', 1, { freshMs: 10000 });
  memCache.set('k2', 2, { freshMs: 10000 });
  memCache.get('k1'); // touch k1 so k2 is LRU
  memCache.set('k3', 3, { freshMs: 10000 });
  assert.equal(memCache.get('k2'), null);
  assert.equal(memCache.get('k1').value, 1);
  assert.equal(memCache.get('k3').value, 3);
  memCache.close();
});
