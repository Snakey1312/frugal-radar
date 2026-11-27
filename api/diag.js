// Temporary diagnostic: full traineddata download timing on Vercel.
const https = require('node:https');

const URLS = {
  best_int: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
  standard: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0/eng.traineddata.gz',
};

function download(url, timeoutMs = 25000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let bytes = 0;
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, bytes, ms: Date.now() - t0 }));
      res.on('aborted', () => resolve({ error: 'aborted', bytes, ms: Date.now() - t0 }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', bytes, ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, bytes, ms: Date.now() - t0 }));
  });
}

module.exports = async (req, res) => {
  const out = {};
  for (const [k, u] of Object.entries(URLS)) out[k] = await download(u);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
