// Temporary diagnostic: probe runtime capabilities on Vercel.
module.exports = async (req, res) => {
  const out = { node: process.version, checks: {} };
  const finish = () => {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(out, null, 2));
  };

  try {
    const { Impit } = require('impit');
    out.checks.impitRequire = 'ok';
    const client = new Impit({ browser: 'chrome', followRedirects: false });
    const t0 = Date.now();
    const r = await client.fetch('https://www.emag.ro/search/nike%20air%20max%20tn%20triple%20black', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    out.checks.impitFetch = { status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    out.checks.impitRequire = 'fail';
    out.checks.impitError = String(e && e.message || e);
  }

  try {
    const { safeFetch } = require('../lib/http-client');
    const t0 = Date.now();
    const r = await safeFetch('https://www.emag.ro/search/nike%20air%20max%20tn%20triple%20black', {
      timeoutMs: 10000,
      maxBytes: 2 * 1024 * 1024,
    });
    out.checks.safeFetch = { status: r.status, ms: Date.now() - t0 };
  } catch (e) {
    out.checks.safeFetch = { error: String(e && e.message || e) };
  }

  try {
    const { storeFetch } = require('../lib/http-client');
    const t0 = Date.now();
    const r = await storeFetch('emag', 'https://www.emag.ro/search/nike%20air%20max%20tn%20triple%20black', {
      timeoutMs: 10000,
      maxBytes: 2 * 1024 * 1024,
      useImpit: true,
    });
    out.checks.storeFetch = { status: r.status, transport: r.transport, ms: Date.now() - t0 };
  } catch (e) {
    out.checks.storeFetch = { error: String(e && e.message || e) };
  }

  finish();
};
