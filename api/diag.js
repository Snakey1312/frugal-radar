// Temporary diagnostic: probe outbound network from Vercel.
const https = require('node:https');

function rawGet(host, path) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get({ host, path, timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, ms: Date.now() - t0 }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

module.exports = async (req, res) => {
  const out = { node: process.version, env: { VERCEL: process.env.VERCEL }, hosts: {} };
  for (const [host, path] of [
    ['example.com', '/'],
    ['www.google.com', '/'],
    ['www.emag.ro', '/search/nike%20air%20max%20tn%20triple%20black'],
    ['fenrir.altex.ro', '/v2/catalog/search/nike?size=10'],
    ['api.github.com', '/'],
  ]) {
    out.hosts[host] = await rawGet(host, path);
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
