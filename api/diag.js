// Temporary diagnostic: which Romanian store hosts accept Vercel egress?
const https = require('node:https');

function rawGet(host, path, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get({ host, path, timeout: timeoutMs, headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0, server: res.headers.server }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

const HOSTS = [
  ['www.emag.ro', '/search/nike%20air%20max%20plus%20tn%20negru'],
  ['altex.ro', '/cautare/nike'],
  ['www.pcgarage.ro', '/cautare/nike/'],
  ['www.flanco.ro', '/catalogsearch/result/?q=nike'],
  ['www.vexio.ro', '/search?q=nike'],
  ['www.evomag.ro', '/cautare/nike'],
  ['www.sportisimo.ro', '/cauta/?q=nike'],
  ['sizeer.ro', '/cautare?query=nike'],
  ['www.intersport.ro', '/cauta/?q=nike'],
  ['www.hervis.ro', '/shop/search/?text=nike'],
  ['www.gymbeam.ro', '/cautare?q=nike'],
  ['www.decathlon.ro', '/search?Ntt=nike'],
  ['www.kaufland.ro', '/cautare?search=nike'],
  ['www.carrefour.ro', '/search?text=nike'],
  ['www.dedeman.ro', '/ro/cautare/nike'],
  ['www.carturesti.ro', '/cautare?q=nike'],
];

module.exports = async (req, res) => {
  const out = {};
  for (const [host, path] of HOSTS) out[host] = await rawGet(host, path);
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
