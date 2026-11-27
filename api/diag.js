// Temporary diagnostic: can keyless reader/proxy services fetch eMAG?
const https = require('node:https');

function rawGet(url, timeoutMs = 12000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(url, { timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/plain,*/*' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.length < 5) chunks.push(c); });
      res.on('end', () => resolve({
        status: res.statusCode,
        ms: Date.now() - t0,
        len: chunks.reduce((a, c) => a + c.length, 0),
        body: Buffer.concat(chunks).toString('utf8').slice(0, 300),
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

const EMAG = 'https://www.emag.ro/search/nike%20air%20max%20plus%20tn%20negru';
const URLS = {
  jina: `https://r.jina.ai/${EMAG}`,
  allorigins: `https://api.allorigins.win/raw?url=${encodeURIComponent(EMAG)}`,
  corsproxy: `https://corsproxy.io/?url=${encodeURIComponent(EMAG)}`,
  codetabs: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(EMAG)}`,
  thingproxy: `https://thingproxy.freeboard.io/fetch/${EMAG}`,
};

module.exports = async (req, res) => {
  const out = {};
  for (const [k, url] of Object.entries(URLS)) out[k] = await rawGet(url);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
