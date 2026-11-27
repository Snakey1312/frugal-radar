// Temporary diagnostic: can we scrape Google/Bing shopping from Vercel?
const https = require('node:https');

function get(url) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const req = https.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => { if (chunks.length < 30) chunks.push(c); });
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          ms: Date.now() - t0,
          len: body.length,
          hasEmag: /emag\.ro/i.test(body),
          hasPrice: /[0-9]+[.,][0-9]{2}\s*lei|RON|Lei/i.test(body),
          preview: body.slice(0, 400).replace(/\s+/g, ' '),
        });
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout', ms: Date.now() - t0 }); });
    req.on('error', (e) => resolve({ error: e.message, ms: Date.now() - t0 }));
  });
}

module.exports = async (req, res) => {
  const out = {};
  out.googleShopping = await get('https://www.google.com/search?q=nike+air+max+plus+tn+negru&tbm=shop&hl=ro');
  out.googleWeb = await get('https://www.google.com/search?q=nike+air+max+plus+tn+negru+emag&hl=ro');
  out.bingShopping = await get('https://www.bing.com/shop?q=nike+air+max+plus+tn+negru&setlang=ro');
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(out, null, 2));
};
