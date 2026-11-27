'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeProductUrl } = require('../lib/search-pipeline');

const challengeHtml = '<html><head><title>Se verifică browserul ... | Cocoons</title></head><body><h1>Se verifică browserul</h1><p>Vă rugăm să verificați browserul pentru a continua.</p></body></html>';

test('analyzeProductUrl falls back to URL slug when the store serves an anti-bot page', async () => {
  const url = 'https://www.spartoo.ro/mobile/Naturino-COCOON-x31928367.php';
  const result = await analyzeProductUrl(url, {
    storeFetch: async () => ({ ok: true, text: challengeHtml, finalUrl: url }),
    cache: { getOrFetch: async (_key, fn) => fn(), get: async () => null, set: async () => {} },
  });

  assert.equal(result.title, 'Naturino COCOON');
  assert.equal(result.distilledQuery, 'naturino cocoon');
  assert.equal(result.scrapedLive, false);
  assert.equal(result.domain, 'spartoo.ro');
});
