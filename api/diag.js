// Temporary diagnostic endpoint for store-fetch geo headers on Vercel.
const { safeFetch } = require('../lib/http-client');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0';
const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

module.exports = async function diag(req, res) {
  const url = String(req.query?.url || 'https://www.emag.ro/pantofi-sport-nike-air-max-plus-iii/fd/6991813/culoare-c5401,negru-v8317693');
  const variants = [
    ['none', {}],
    ['xff_telekom', { 'X-Forwarded-For': '81.196.1.1' }],
    ['xff_rcs', { 'X-Forwarded-For': '89.132.1.1' }],
    ['xff_edu', { 'X-Forwarded-For': '193.231.1.1' }],
    ['xff_orange', { 'X-Forwarded-For': '109.99.1.1' }],
    ['real_ip', { 'X-Real-IP': '81.196.1.1' }],
  ];

  const out = [];
  for (const [name, extra] of variants) {
    try {
      const r = await safeFetch(url, { timeoutMs: 8000, headers: { ...BASE_HEADERS, ...extra } });
      const html = r.text || '';
      const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
      out.push({
        name,
        status: r.status,
        ok: Boolean(r.ok),
        error: r.error || null,
        len: html.length,
        title: title.replace(/\s+/g, ' ').trim().slice(0, 90),
        captcha: /captcha|verificare|unusual traffic|access denied/i.test(html),
        characteristics: /EM\.product\.characteristics/i.test(html),
        has41: /"(?:41|41\.0)"\s*:/.test(html),
      });
    } catch (e) {
      out.push({ name, error: e.message });
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out));
};
