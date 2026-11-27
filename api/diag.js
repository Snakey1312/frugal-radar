// Temporary diagnostic endpoint for Bing Shopping market variants.
const { safeFetch } = require('../lib/http-client');
const { parseBingShoppingHtml } = require('../lib/adapters');

const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
const BASE_HEADERS = { 'User-Agent': UA_EDGE, 'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8' };
const RO_COOKIE = 'SRCHHPGUSR=SRCHLANG=ro&ADLT=OFF&MKT=ro-RO; _EDGE_S=mkt=ro-ro';

module.exports = async function diag(req, res) {
  const q = String(req.query?.q || 'nike air max plus tn negru');
  const base = `https://www.bing.com/shop?q=${encodeURIComponent(q)}&setlang=ro`;
  const market = `${base}&cc=ro&mkt=ro-RO`;
  const variants = [
    ['plain', base, {}],
    ['cc_mkt', market, {}],
    ['xff_ro', base, { 'X-Forwarded-For': '89.132.1.1' }],
    ['xff_ro_mkt', market, { 'X-Forwarded-For': '89.132.1.1' }],
    ['real_ip_ro', base, { 'X-Real-IP': '89.132.1.1' }],
    ['cookie_ro', base, { Cookie: RO_COOKIE }],
    ['cookie_ro_mkt', market, { Cookie: RO_COOKIE }],
    ['accept_country', base, { 'Accept-Country': 'RO', 'X-Accept-Country': 'RO' }],
    ['cf_country', base, { 'CF-IPCountry': 'RO' }],
  ];

  const out = [];
  for (const [name, url, extraHeaders] of variants) {
    try {
      const r = await safeFetch(url, {
        timeoutMs: 6000,
        headers: { ...BASE_HEADERS, ...extraHeaders },
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
        title: title.replace(/\s+/g, ' ').trim().slice(0, 100),
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
