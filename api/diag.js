// Temporary diagnostic: Tesseract init variants on Vercel.
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r({ error: 'outer timeout' }), ms))]);
}

async function tryVariant(name, opts) {
  const events = [];
  const t0 = Date.now();
  try {
    const { createWorker } = require('tesseract.js');
    const maybe = await withTimeout(createWorker('eng', 1, { ...opts, logger: (m) => events.push(`${m.status}:${m.progress ?? ''}`) }), 12000);
    if (maybe && maybe.error) return { [name]: { error: maybe.error, events } };
    const out = { [name]: { ok: true, ms: Date.now() - t0, events } };
    if (maybe) await maybe.terminate().catch(() => {});
    return out;
  } catch (e) {
    return { [name]: { error: String(e && e.message || e), events } };
  }
}

module.exports = async (req, res) => {
  const out = {};
  Object.assign(out, await tryVariant('cacheTmp', { cachePath: '/tmp' }));
  Object.assign(out, await tryVariant('noCache', { cachePath: '/tmp', cacheMethod: 'none' }));
  Object.assign(out, await tryVariant('default', {}));
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
