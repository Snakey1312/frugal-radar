// Temporary diagnostic: Tesseract startup on Vercel.
const https = require('node:https');
const path = require('node:path');
const fs = require('node:fs');

function head(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      let n = 0;
      res.on('data', (c) => { n += c.length; if (n > 200000) req.destroy(); });
      res.on('end', () => resolve({ status: res.statusCode, bytes: n, ms: Date.now() - t0 }));
      res.on('close', () => resolve({ status: res.statusCode, bytes: n, ms: Date.now() - t0, closed: true }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r({ error: 'outer timeout' }), ms))]);
}

module.exports = async (req, res) => {
  const out = {};
  out.cdn = await head('https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  try {
    const p = path.join(process.cwd(), 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
    out.workerScript = { path: p, exists: fs.existsSync(p) };
  } catch (e) { out.workerScript = { error: e.message }; }

  try {
    const { createWorker } = require('tesseract.js');
    const t0 = Date.now();
    const worker = await withTimeout(createWorker('eng', 1, {
      cachePath: '/tmp/frugalradar-tessdata',
      logger: () => {},
    }), 25000);
    out.worker = worker && worker.error ? worker.error : { ok: true, ms: Date.now() - t0 };
    if (worker && !worker.error) await worker.terminate().catch(() => {});
  } catch (e) { out.worker = { error: String(e && e.message || e) }; }

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
