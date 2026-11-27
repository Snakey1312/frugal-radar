// Temporary diagnostic: does Emscripten Core init work in main thread vs worker?
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r({ error: 'outer timeout' }), ms))]);
}

module.exports = async (req, res) => {
  const out = {};

  out.mainThread = await withTimeout((async () => {
    const t0 = Date.now();
    try {
      const Core = require('tesseract.js-core/tesseract-core-simd-lstm');
      const mod = await Core({});
      return { ok: true, ms: Date.now() - t0, hasInit: typeof mod._Init === 'function' || typeof mod.cwrap === 'function' };
    } catch (e) { return { error: String(e && e.message || e), ms: Date.now() - t0 }; }
  })(), 15000);

  out.workerThread = await withTimeout(new Promise((resolve) => {
    const t0 = Date.now();
    try {
      const { Worker } = require('node:worker_threads');
      const code = `
        const { parentPort } = require('node:worker_threads');
        const Core = require('tesseract.js-core/tesseract-core-simd-lstm');
        Core({}).then((m) => parentPort.postMessage({ ok: true, hasCwrap: typeof m.cwrap === 'function' }))
          .catch((e) => parentPort.postMessage({ error: String(e && e.message || e) }));
      `;
      const w = new Worker(code, { eval: true });
      w.on('message', (m) => { w.terminate(); resolve({ ...m, ms: Date.now() - t0 }); });
      w.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
      setTimeout(() => { w.terminate(); resolve({ error: 'no message in 12s', ms: Date.now() - t0 }); }, 12000);
    } catch (e) { resolve({ error: e.message }); }
  }), 15000);

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
