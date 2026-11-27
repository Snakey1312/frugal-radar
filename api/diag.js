// Temporary diagnostic endpoint for Bing Shopping market variants.
const { safeFetch } = require('../lib/http-client');
const { parseBingShoppingHtml } = require('../lib/adapters');

const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';

module.exports = async function diag(req, res) {
  const q = String(req.query?.q || 'nike air max plus tn negru');
  const base = `https://www.bing.com/shop?q=${encodeURIComponent(q)}`;
  const variants = [
    ['plain', `${base}&setlang=ro`],
    ['cc_ro', `${base}&setlang=ro&cc=ro`],
    ['mkt_ro', `${base}&setlang=ro&mkt=ro-RO`],
    ['cc_mkt', `${base}&setlang=ro&cc=ro&mkt=ro-RO`],
    ['cc_upper', `${base}&setlang=ro&cc=RO&mkt=ro-RO`],
    ['ensearch', `${base}&setlang=ro&cc=ro&mkt=ro-RO&ensearch=1`],
  ];

  const out = [];
  for (const [name, url] of variants) {
    try {
      const r = await safeFetch(url, {
        timeoutMs: 6000,
        headers: { 'User-Agent': UA_EDGE, 'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8' },
      });
      const html = r.text || '';
      const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      const matches = parseBingShoppingHtml(html);
      out.push({
        name,
        status: r.status,
        ok: Boolean(r.ok),
        error: r.error || null,
        len: html.length,
        offLinks: (html.match(/br-offLink/g) || []).length,
        prices: (html.match(/br-price/g) || []).length,
        parsed: matches.length,
        title: title.replace(/\s+/g, ' ').trim().slice(0, 120),
        sample: matches.slice(0, 2).map((m) => `${m.title} | ${m.price} | ${m.customStoreName}`),
      });
    } catch (e) {
      out.push({ name, error: e.message });
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out));
};
