// Temporary diagnostic: isolate Tesseract worker hang on Vercel.
const fs = require('node:fs');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((r) => setTimeout(() => r({ error: 'outer timeout' }), ms))]);
}

module.exports = async (req, res) => {
  const out = {};

  // 1. Is tesseract.js-core present and resolvable?
  try {
    const coreDir = path.join(process.cwd(), 'node_modules', 'tesseract.js-core');
    out.coreDir = { exists: fs.existsSync(coreDir), files: fs.existsSync(coreDir) ? fs.readdirSync(coreDir).slice(0, 12) : [] };
    const simdPath = path.join(coreDir, 'tesseract-core-simd-lstm.js');
    out.simdCore = { exists: fs.existsSync(simdPath), size: fs.existsSync(simdPath) ? fs.statSync(simdPath).size : 0 };
    const wasmDir = path.join(coreDir, 'wasm');
    out.wasm = { exists: fs.existsSync(wasmDir), files: fs.existsSync(wasmDir) ? fs.readdirSync(wasmDir).slice(0, 20) : [] };
  } catch (e) { out.coreDir = { error: e.message }; }

  // 2. Do plain worker_threads work at all?
  out.plainWorker = await withTimeout(new Promise((resolve) => {
    try {
      const w = new Worker('require("node:worker_threads").parentPort.postMessage("hi")', { eval: true });
      w.on('message', (m) => { w.terminate(); resolve({ ok: true, message: m }); });
      w.on('error', (e) => resolve({ error: e.message }));
      setTimeout(() => { w.terminate(); resolve({ error: 'no message in 5s' }); }, 5000);
    } catch (e) { resolve({ error: e.message }); }
  }), 8000);

  // 3. Can the real worker script be instantiated?
  out.realWorker = await withTimeout(new Promise((resolve) => {
    try {
      const wp = path.join(process.cwd(), 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
      const w = new Worker(wp);
      w.on('online', () => { resolve({ online: true }); });
      w.on('error', (e) => resolve({ error: e.message }));
      setTimeout(() => { w.terminate(); resolve({ error: 'no online in 8s' }); }, 8000);
    } catch (e) { resolve({ error: e.message }); }
  }), 10000);

  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
