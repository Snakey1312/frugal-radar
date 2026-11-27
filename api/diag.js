// Temporary diagnostic: keyless result sources reachable from Vercel.
const https = require('node:https');

function get(url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.length < 40) chunks.push(c); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({ status: res.statusCode, ms: Date.now() - t0, len: body.length,
          hasNike: /nike/i.test(body), hasEmag: /emag/i.test(body),
          preview: body.slice(0, 220).replace(/\s+/g, ' ') });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

const Q = 'nike+air+max+plus+tn+negru';
module.exports = async (req, res) => {
  const out = {};
  out.bingRss = await get(`https://www.bing.com/search?q=${Q}&format=rss&setlang=ro`);
  out.bingWeb = await get(`https://www.bing.com/search?q=${Q}&setlang=ro`);
  out.priceRo = await get('https://www.price.ro/');
  out.compari = await get('https://www.compari.ro/');
  out.shopmania = await get('https://www.shopmania.ro/');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
