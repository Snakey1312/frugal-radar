// Temporary diagnostic: inspect aggregator search results from Vercel.
const https = require('node:https');

function get(url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36', 'Accept-Language': 'ro-RO,ro;q=0.9' },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.length < 60) chunks.push(c); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const snippets = [];
        const re = /.{0,120}(?:Air Max|air\s*max|TN|triple black|negru|lei|RON).{0,160}/gi;
        let m;
        while ((m = re.exec(body)) && snippets.length < 8) snippets.push(m[0].replace(/\s+/g, ' '));
        resolve({ status: res.statusCode, ms: Date.now() - t0, len: body.length,
          nike: (body.match(/nike/gi) || []).length,
          emag: (body.match(/emag/gi) || []).length,
          snippets });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

module.exports = async (req, res) => {
  const out = {};
  out.bingRss = await get('https://www.bing.com/search?q=nike+air+max+plus+tn+negru&format=rss&setlang=ro');
  out.priceSearch1 = await get('https://www.price.ro/index.php?action=cautare&q=nike%20air%20max%20plus%20tn%20negru');
  out.priceSearch2 = await get('https://www.price.ro/cautare/nike%20air%20max%20plus%20tn%20negru');
  out.shopmaniaSearch = await get('https://www.shopmania.ro/search?q=nike+air+max+plus+tn+negru');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
