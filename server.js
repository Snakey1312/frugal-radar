const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { cache } = require('./lib/cache');
const { safeFetch } = require('./lib/http-client');
const { getPublicStoresSummary } = require('./lib/adapters');
const { identifyImageLocally } = require('./lib/local-ocr');
const {
  runSearchPipeline,
  checkStockBatch,
  analyzeProductUrl,
} = require('./lib/search-pipeline');

const DEFAULT_PORT = process.env.PORT || 3456;
const PUBLIC_DIR = path.resolve(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_IDENTIFY_BODY_BYTES = 6 * 1024 * 1024;
const MAX_JSON_BODY_BYTES = 1 * 1024 * 1024;
const VALID_IDENTIFY_CATEGORIES = new Set([
  'shoes', 'clothes', 'electronics', 'supplements', 'pharmacy_beauty', 'diy_home', 'books', 'general',
]);

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function createRateLimiter({ windowMs = 10 * 60 * 1000, maxRequests = 12 } = {}) {
  const hits = new Map();
  return function checkLimit(ip) {
    const now = Date.now();
    const key = String(ip || 'unknown');
    const recent = (hits.get(key) || []).filter((ts) => now - ts < windowMs);
    if (recent.length >= maxRequests) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 1000) {
      for (const [k, list] of hits.entries()) {
        if (list.every((ts) => now - ts >= windowMs)) hits.delete(k);
      }
    }
    return true;
  };
}

function readJsonBody(req, maxBytes = MAX_JSON_BODY_BYTES) {
  // Vercel may hand us an already-parsed body; plain Node streams it instead.
  if (req.body !== undefined && req.body !== null) {
    try {
      const parsed = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      return Promise.resolve(parsed);
    } catch {
      return Promise.reject(Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 }));
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    req.on('data', (chunk) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        const err = new Error('Payload too large');
        err.statusCode = 413;
        req.destroy();
        reject(err);
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        const err = new Error('Invalid JSON payload');
        err.statusCode = 400;
        reject(err);
      }
    });

    req.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
  });
  res.end(text);
}

function serveStatic(req, res, rawPathname, publicDir = PUBLIC_DIR) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPathname || '/');
  } catch {
    return sendText(res, 400, 'Bad Request');
  }

  if (decodedPath.includes('\0')) {
    return sendText(res, 400, 'Bad Request');
  }

  const safeRel = decodedPath === '/' ? '/index.html' : decodedPath;
  const resolved = path.resolve(publicDir, `.${safeRel.startsWith('/') ? safeRel : `/${safeRel}`}`);
  const rel = path.relative(publicDir, resolved);

  if (rel.startsWith('..') || path.isAbsolute(rel) || (resolved !== publicDir && !resolved.startsWith(publicDir + path.sep))) {
    return sendText(res, 403, 'Forbidden');
  }

  let realPublic;
  let realTarget;
  try {
    realPublic = fs.realpathSync(publicDir);
    realTarget = fs.realpathSync(resolved);
  } catch (err) {
    if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) {
      return sendText(res, 404, 'Not found');
    }
    return sendText(res, 403, 'Forbidden');
  }

  const realRel = path.relative(realPublic, realTarget);
  if (realRel.startsWith('..') || path.isAbsolute(realRel) || (realTarget !== realPublic && !realTarget.startsWith(realPublic + path.sep))) {
    return sendText(res, 403, 'Forbidden');
  }

  fs.stat(realTarget, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      return sendText(res, 404, 'Not found');
    }
    fs.readFile(realTarget, (readErr, content) => {
      if (readErr) {
        return sendText(res, 404, 'Not found');
      }
      const ext = path.extname(realTarget).toLowerCase();
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': content.length,
      });
      res.end(content);
    });
  });
}

function getHeaderString(req, headerName) {
  const val = req.headers[headerName.toLowerCase()];
  if (Array.isArray(val)) return String(val[0] || '').trim();
  return val ? String(val).trim() : '';
}

function normalizeIdentifyResult(result, source) {
  if (!result || !String(result.query || '').trim()) return null;
  const category = VALID_IDENTIFY_CATEGORIES.has(String(result.category || '').trim())
    ? String(result.category).trim()
    : 'general';
  const confidence = Number.isFinite(Number(result.confidence))
    ? Math.max(0, Math.min(1, Number(result.confidence)))
    : null;
  return {
    query: String(result.query).trim().slice(0, 160),
    category,
    size: String(result.size || '').trim().slice(0, 20),
    source,
    confidence,
    needsConfirmation: confidence == null ? source === 'local_ocr' : confidence < 0.8,
  };
}

function createAppServer(deps = {}) {
  const _runSearch = deps.runSearchPipeline || runSearchPipeline;
  const _checkStockBatch = deps.checkStockBatch || checkStockBatch;
  const _analyzeUrl = deps.analyzeProductUrl || analyzeProductUrl;
  const _getStoresSummary = deps.getPublicStoresSummary || getPublicStoresSummary;
  const _safeFetch = deps.safeFetch || safeFetch;
  const _localIdentify = deps.localImageIdentifier || identifyImageLocally;
  const _publicDir = deps.publicDir ? path.resolve(deps.publicDir) : PUBLIC_DIR;
  const _checkIdentifyRate = createRateLimiter(deps.rateLimit || { windowMs: 10 * 60 * 1000, maxRequests: 12 });

  async function handleStores(req, res) {
    try {
      const summary = _getStoresSummary();
      return sendJson(res, 200, summary);
    } catch {
      return sendJson(res, 500, { error: 'Nu am putut încărca lista de magazine.' });
    }
  }

  async function handleSearch(req, res) {
    try {
      const body = await readJsonBody(req);
      const headerKey = getHeaderString(req, 'x-serper-key');
      const effectiveSerperKey = headerKey || String(body.serperKey || '').trim() || String(process.env.SERPER_API_KEY || '').trim();
      const result = await _runSearch({
        ...body,
        serperKey: effectiveSerperKey,
      });
      return sendJson(res, 200, result);
    } catch (err) {
      const status = err?.statusCode || 500;
      const msg = status >= 500 ? 'Eroare la căutarea ofertelor.' : err.message;
      return sendJson(res, status, { error: msg });
    }
  }

  async function handleCheckStock(req, res) {
    try {
      const body = await readJsonBody(req);
      if (!Array.isArray(body.urls) || body.urls.length === 0) {
        return sendJson(res, 400, { error: 'Lista de URL-uri este goală.' });
      }
      const result = await _checkStockBatch({
        urls: body.urls,
        category: body.category || 'shoes',
        desiredSize: body.desiredSize || body.size || '',
      });
      return sendJson(res, 200, result);
    } catch (err) {
      const status = err?.statusCode || 500;
      return sendJson(res, status, { error: status >= 500 ? 'Eroare la verificarea stocului.' : err.message });
    }
  }

  async function handleAnalyzeUrl(req, res) {
    try {
      const body = await readJsonBody(req);
      const result = await _analyzeUrl(body.url);
      return sendJson(res, 200, result);
    } catch (err) {
      const status = err?.statusCode || 500;
      return sendJson(res, status, { error: status >= 500 ? 'Nu am putut analiza link-ul.' : err.message });
    }
  }

  async function handleIdentifyImage(req, res) {
    try {
      const body = await readJsonBody(req, MAX_IDENTIFY_BODY_BYTES);
      const mimeType = String(body.mimeType || '').trim().toLowerCase();
      if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
        return sendJson(res, 400, { error: 'Format imagine neacceptat. Folosește PNG, JPG, WebP sau GIF.' });
      }

      const rawBase64 = String(body.base64 || '').replace(/^data:[^;]+;base64,/i, '').trim();
      if (!rawBase64) {
        return sendJson(res, 400, { error: 'Imagine lipsă.' });
      }

      const byteLen = Buffer.byteLength(rawBase64, 'base64');
      if (byteLen === 0 || byteLen > MAX_IMAGE_BYTES) {
        return sendJson(res, 413, { error: 'Imaginea depășește limita de 4 MB.' });
      }

      const tryLocal = async () => normalizeIdentifyResult(
        await _localIdentify(rawBase64, mimeType),
        'local_ocr',
      );

      const byokKey = getHeaderString(req, 'x-gemini-key');
      const envKey = String(process.env.GEMINI_API_KEY || '').trim();
      const apiKey = byokKey || envKey;

      if (!apiKey) {
        const local = await tryLocal();
        if (local) return sendJson(res, 200, local);
        return sendJson(res, 422, {
          error: 'Nu am putut citi produsul din imagine. Scrie numele manual sau adaugă o cheie Gemini în Setări AI.',
        });
      }

      if (!byokKey && envKey) {
        const clientIp = req.socket?.remoteAddress || 'unknown';
        if (!_checkIdentifyRate(clientIp)) {
          return sendJson(res, 429, { error: 'Prea multe cereri de identificare. Încearcă din nou mai târziu.' });
        }
      }

      const geminiPayload = JSON.stringify({
        contents: [{
          parts: [
            {
              text: [
                'Identifică produsul din imagine pentru compararea prețurilor în România.',
                'Folosește DOAR ce se vede pe etichetă, ambalaj sau produs; nu ghici și nu inventa detalii.',
                'Extrage brandul, modelul exact (inclusiv numărul/generația), culoarea, capacitatea și mărimea dacă sunt vizibile.',
                'Câmpul "query" trebuie să aibă 3-8 cuvinte: brand + model + culoare (+ capacitate pentru electronice sau suplimente).',
                'Nu include magazine, prețuri, nume de fișier, cuvinte promoționale sau text care nu descrie produsul.',
                'Category trebuie să fie una dintre: shoes, clothes, electronics, supplements, pharmacy_beauty, diy_home, books, general.',
                'Dacă nu poți citi sigur modelul, lasă "query" gol și pune "confidence" sub 0.5.',
                'Răspunde DOAR cu JSON valid: {"query":"","category":"general","brand":"","model":"","color":"","size":"","confidence":0}.',
              ].join('\n'),
            },
            { inline_data: { mime_type: mimeType, data: rawBase64 } },
          ],
        }],
      });

      let geminiRes;
      try {
        geminiRes = await _safeFetch(
          'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey,
            },
            body: geminiPayload,
            timeoutMs: 12000,
            maxBytes: 512000,
            maxRedirects: 0,
          }
        );
      } catch {
        geminiRes = null;
      }

      if (geminiRes?.ok) {
        try {
          const parsed = geminiRes.json || JSON.parse(geminiRes.text || '{}');
          const parts = parsed?.candidates?.[0]?.content?.parts || [];
          const rawText = parts.map((p) => p?.text || '').join('');
          const cleaned = rawText.replace(/```json|```/gi, '').trim();
          const result = JSON.parse(cleaned);
          const normalized = normalizeIdentifyResult(result, 'gemini');
          if (normalized) return sendJson(res, 200, normalized);
        } catch { /* fall back to local OCR */ }
      }

      const local = await tryLocal();
      if (local) return sendJson(res, 200, local);
      return sendJson(res, 502, { error: 'Serviciul Gemini Vision nu a identificat produsul. Confirmă numele mai jos.' });
    } catch (err) {
      const status = err?.statusCode || 500;
      return sendJson(res, status, { error: status >= 500 ? 'Nu am putut identifica produsul din imagine.' : err.message });
    }
  }

  const handler = (req, res) => {
    const rawPathOnly = String(req.url || '/').split('?')[0];
    let decodedRawPath;
    try {
      decodedRawPath = decodeURIComponent(rawPathOnly);
    } catch {
      return sendText(res, 400, 'Bad Request');
    }
    if (decodedRawPath.includes('\0') || decodedRawPath.split(/[/\\]/).includes('..')) {
      return sendText(res, 403, 'Forbidden');
    }

    let reqUrl;
    try {
      reqUrl = new URL(req.url || '/', 'http://localhost');
    } catch {
      return sendText(res, 400, 'Bad Request');
    }

    if (req.method === 'GET' && reqUrl.pathname === '/api/stores') return handleStores(req, res);
    if (req.method === 'POST' && reqUrl.pathname === '/api/search') return handleSearch(req, res);
    if (req.method === 'POST' && reqUrl.pathname === '/api/check-stock') return handleCheckStock(req, res);
    if (req.method === 'POST' && reqUrl.pathname === '/api/analyze-url') return handleAnalyzeUrl(req, res);
    if (req.method === 'POST' && reqUrl.pathname === '/api/identify-image') return handleIdentifyImage(req, res);
    if (req.method === 'GET') return serveStatic(req, res, reqUrl.pathname, _publicDir);

    res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Method Not Allowed');
  };

  const server = http.createServer(handler);
  server.handler = handler;
  return server;
}

if (require.main === module) {
  const server = createAppServer();
  server.listen(DEFAULT_PORT, () => {
    console.log(`FrugalRadar rulează la http://localhost:${DEFAULT_PORT}`);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    server.close(() => {
      try {
        cache.close();
      } catch { /* ignore */ }
      process.exit(0);
    });
    const forceTimer = setTimeout(() => {
      try {
        cache.close();
      } catch { /* ignore */ }
      process.exit(0);
    }, 3000);
    if (typeof forceTimer.unref === 'function') forceTimer.unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

module.exports = {
  createAppServer,
  serveStatic,
  SECURITY_HEADERS,
};
