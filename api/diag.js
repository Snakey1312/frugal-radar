// Temporary diagnostic: trace Tesseract createWorker progress on Vercel.
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r({ error: 'outer timeout' }), ms))]);
}

module.exports = async (req, res) => {
  const events = [];
  const out = { events };
  try {
    const { createWorker } = require('tesseract.js');
    const t0 = Date.now();
    const logger = (m) => events.push(`${Date.now() - t0}ms ${m.status} ${m.progress != null ? m.progress : ''}`.trim());
    const maybeWorker = await withTimeout(createWorker('eng', 1, {
      cachePath: '/tmp/frugalradar-tessdata',
      logger,
    }), 30000);
    out.result = maybeWorker && maybeWorker.error ? maybeWorker.error : { ok: true, ms: Date.now() - t0 };
    if (maybeWorker && !maybeWorker.error) await maybeWorker.terminate().catch(() => {});
  } catch (e) {
    out.result = { error: String(e && e.message || e) };
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
