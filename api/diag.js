// Temporary diagnostic: inspect 511 responses from Vercel egress.
const https = require('node:https');

function rawGet(host, path) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get({ host, path, timeout: 8000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.length < 4) chunks.push(c); });
      res.on('end', () => resolve({
        status: res.statusCode,
        ms: Date.now() - t0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8').slice(0, 400),
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

module.exports = async (req, res) => {
  const out = {};
  for (const [host, path] of [
    ['www.emag.ro', '/search/nike%20air%20max%20tn%20triple%20black'],
    ['api.github.com', '/'],
    ['example.com', '/'],
  ]) {
    out[host] = await rawGet(host, path);
  }
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
