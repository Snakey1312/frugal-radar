'use strict';

const http = require('node:http');
const https = require('node:https');
const dnsPromises = require('node:dns/promises');
const zlib = require('node:zlib');
const { URL } = require('node:url');
const ipaddr = require('ipaddr.js');

const DEFAULT_TIMEOUT_MS = 4500;
const DEFAULT_MAX_BYTES = 1500000;
const DEFAULT_MAX_REDIRECTS = 3;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_TLDS = new Set([
  'local',
  'internal',
  'lan',
  'arpa',
  'localhost',
  'localdomain',
  'home',
  'corp',
  'intranet',
]);

const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ro-RO,ro;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

const COOLDOWN_MS = {
  bot_blocked: 15 * 60 * 1000,
  timeout: 3 * 60 * 1000,
  network_error: 3 * 60 * 1000,
  parse_drift: 30 * 60 * 1000,
};

const CONSECUTIVE_FAILURE_KINDS = new Set(['bot_blocked', 'timeout', 'network_error']);
const CONSECUTIVE_TRIP_THRESHOLD = 3;
const PARSE_DRIFT_WINDOW = 10;
const PARSE_DRIFT_TRIP_THRESHOLD = 4;

/**
 * Strip IPv6 brackets and trailing dot from a hostname for validation.
 */
function normalizeHost(hostname) {
  let host = String(hostname || '').trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }
  if (host.endsWith('.')) {
    host = host.slice(0, -1);
  }
  return host;
}

/**
 * Return true if an IP string parses via ipaddr.js and belongs to a public unicast range.
 * ipaddr.process() unwraps IPv4-mapped IPv6 addresses (::ffff:*) to IPv4 before checking range().
 */
function isPublicIp(ipStr) {
  const clean = normalizeHost(ipStr);
  if (!clean || clean.includes('%') || !ipaddr.isValid(clean)) {
    return false;
  }
  const addr = ipaddr.process(clean);
  return addr.range() === 'unicast';
}

/**
 * Validate that a raw URL is an http/https public URL without userinfo,
 * private/reserved IP literals, single-label hosts, or internal TLDs.
 * @param {string} rawUrl
 * @returns {URL | null}
 */
function isSafePublicUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  if (parsed.username !== '' || parsed.password !== '') {
    return null;
  }

  const host = normalizeHost(parsed.hostname);
  if (!host || host.includes('%') || /\s/.test(host)) {
    return null;
  }

  if (ipaddr.isValid(host)) {
    return isPublicIp(host) ? parsed : null;
  }

  // Reject single-label hostnames (e.g. "localhost", "redis", "metadata")
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => label.length === 0)) {
    return null;
  }

  const tld = labels[labels.length - 1];
  if (BLOCKED_TLDS.has(tld)) {
    return null;
  }

  return parsed;
}

function createSsrfError(message) {
  const err = new Error(message);
  err.code = 'ERR_SSRF_BLOCKED';
  return err;
}

/**
 * Resolve all A/AAAA records for a hostname and verify every returned IP is public unicast.
 * Literal IP hosts skip DNS and are validated directly.
 */
async function resolveAndValidateHost(hostname, dnsLookup = dnsPromises.lookup) {
  const cleanHost = normalizeHost(hostname);
  if (ipaddr.isValid(cleanHost)) {
    if (!isPublicIp(cleanHost)) {
      throw createSsrfError(`Blocked non-public IP literal: ${cleanHost}`);
    }
    const family = ipaddr.process(cleanHost).kind() === 'ipv6' ? 6 : 4;
    return [{ address: cleanHost, family }];
  }

  const resolved = await dnsLookup(cleanHost, { all: true });
  const list = Array.isArray(resolved) ? resolved : [resolved];
  if (list.length === 0) {
    throw new Error(`DNS resolution returned no records for ${cleanHost}`);
  }

  const validated = [];
  for (const entry of list) {
    if (!entry || !entry.address || !isPublicIp(entry.address)) {
      throw createSsrfError(
        `Blocked resolved non-public IP ${entry && entry.address ? entry.address : 'unknown'} for ${cleanHost}`
      );
    }
    const family = entry.family || (ipaddr.process(normalizeHost(entry.address)).kind() === 'ipv6' ? 6 : 4);
    validated.push({ address: normalizeHost(entry.address), family });
  }

  return validated;
}

/**
 * Build a custom net.connect/http.request lookup function pinned to pre-validated IPs.
 * Prevents DNS rebinding TOCTOU between validation and TCP connect.
 */
function createPinnedLookup(addresses) {
  return function pinnedLookup(_hostname, opts, cb) {
    let options = opts;
    let callback = cb;
    if (typeof opts === 'function') {
      callback = opts;
      options = {};
    }

    if (options && options.all) {
      return process.nextTick(() =>
        callback(
          null,
          addresses.map((a) => ({ address: a.address, family: a.family }))
        )
      );
    }

    const reqFamily = options && (options.family === 4 || options.family === 6) ? options.family : null;
    const picked = reqFamily ? addresses.find((a) => a.family === reqFamily) : addresses[0];
    if (!picked) {
      const err = new Error(`No pinned IP matching family ${reqFamily}`);
      err.code = 'ENOTFOUND';
      return process.nextTick(() => callback(err));
    }

    return process.nextTick(() => callback(null, picked.address, picked.family));
  };
}

function normalizeHeaders(rawHeaders) {
  const out = {};
  if (!rawHeaders) return out;

  if (typeof rawHeaders.forEach === 'function') {
    rawHeaders.forEach((value, key) => {
      out[String(key).toLowerCase()] = String(value);
    });
    return out;
  }

  for (const [k, v] of Object.entries(rawHeaders)) {
    if (v === undefined) continue;
    out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
  }
  return out;
}

function hasHeaderCaseInsensitive(headers, targetLower) {
  for (const key of Object.keys(headers || {})) {
    if (key.toLowerCase() === targetLower) return true;
  }
  return false;
}

function tryParseJson(text, contentType) {
  if (!text) return null;
  const trimmed = text.trim();
  const looksJson =
    (contentType && contentType.toLowerCase().includes('json')) ||
    trimmed.startsWith('{') ||
    trimmed.startsWith('[');
  if (!looksJson) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function makeErrorResult(rawUrl, error, extra = {}) {
  return {
    ok: false,
    status: extra.status || 0,
    headers: extra.headers || {},
    text: '',
    json: null,
    finalUrl: extra.finalUrl || rawUrl,
    bytes: extra.bytes || 0,
    error: String(error || 'Request failed'),
  };
}

/**
 * Perform a single HTTP/HTTPS request with pinned DNS lookup, timeout, decompression, and byte limit.
 */
function executeSingleHttpRequest(parsedUrl, addresses, { method, headers, body, timeoutMs, maxBytes }) {
  return new Promise((resolve) => {
    const isHttps = parsedUrl.protocol === 'https:';
    const transport = isHttps ? https : http;

    const reqHeaders = { ...DEFAULT_HEADERS, ...headers };
    if (!hasHeaderCaseInsensitive(reqHeaders, 'host')) {
      reqHeaders.Host = parsedUrl.host;
    }

    const requestOptions = {
      protocol: parsedUrl.protocol,
      hostname: normalizeHost(parsedUrl.hostname),
      port: parsedUrl.port ? Number(parsedUrl.port) : isHttps ? 443 : 80,
      path: `${parsedUrl.pathname || '/'}${parsedUrl.search || ''}`,
      method,
      headers: reqHeaders,
      lookup: createPinnedLookup(addresses),
    };

    if (isHttps) {
      requestOptions.servername = normalizeHost(parsedUrl.hostname);
    }

    let settled = false;
    let rawBytes = 0;
    let decompressedBytes = 0;
    let timer = null;
    let activeRes = null;
    let activeDecoder = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    const abortAll = (errorMessage, status = 0, resHeaders = {}) => {
      try {
        if (activeDecoder && !activeDecoder.destroyed) activeDecoder.destroy();
      } catch {}
      try {
        if (activeRes && !activeRes.destroyed) activeRes.destroy();
      } catch {}
      try {
        if (!req.destroyed) req.destroy();
      } catch {}
      finish(
        makeErrorResult(parsedUrl.toString(), errorMessage, {
          status,
          headers: resHeaders,
          finalUrl: parsedUrl.toString(),
          bytes: rawBytes,
        })
      );
    };

    const req = transport.request(requestOptions, (res) => {
      activeRes = res;
      const status = res.statusCode || 0;
      const resHeaders = normalizeHeaders(res.headers);

      if (REDIRECT_STATUSES.has(status) && resHeaders.location) {
        res.destroy();
        if (timer) clearTimeout(timer);
        finish({
          redirect: true,
          status,
          headers: resHeaders,
          location: resHeaders.location,
        });
        return;
      }

      const contentLength = Number(resHeaders['content-length']);
      if (Number.isFinite(contentLength) && contentLength > maxBytes) {
        abortAll(`Response Content-Length (${contentLength}) exceeded maxBytes (${maxBytes})`, status, resHeaders);
        return;
      }

      const encoding = (resHeaders['content-encoding'] || '').toLowerCase().trim();
      let stream = res;

      if (encoding === 'gzip' || encoding === 'x-gzip') {
        activeDecoder = zlib.createGunzip();
      } else if (encoding === 'deflate') {
        activeDecoder = zlib.createInflate();
      } else if (encoding === 'br') {
        activeDecoder = zlib.createBrotliDecompress();
      }

      res.on('data', (chunk) => {
        if (settled) return;
        rawBytes += chunk.length;
        if (rawBytes > maxBytes) {
          abortAll(`Response exceeded maxBytes limit (${maxBytes})`, status, resHeaders);
        }
      });

      res.on('error', (err) => {
        abortAll(err.message || 'Response stream error', status, resHeaders);
      });

      if (activeDecoder) {
        stream = res.pipe(activeDecoder);
        activeDecoder.on('error', (err) => {
          abortAll(`Decompression error: ${err.message}`, status, resHeaders);
        });
      }

      const chunks = [];
      stream.on('data', (chunk) => {
        if (settled) return;
        decompressedBytes += chunk.length;
        if (decompressedBytes > maxBytes) {
          abortAll(`Decompressed response exceeded maxBytes limit (${maxBytes})`, status, resHeaders);
          return;
        }
        chunks.push(chunk);
      });

      stream.on('end', () => {
        if (settled) return;
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        const json = tryParseJson(text, resHeaders['content-type']);
        finish({
          ok: status >= 200 && status < 300,
          status,
          headers: resHeaders,
          text,
          json,
          finalUrl: parsedUrl.toString(),
          bytes: Math.max(rawBytes, buf.length),
          error: null,
        });
      });
    });

    req.on('error', (err) => {
      abortAll(err.message || 'Network request failed');
    });

    timer = setTimeout(() => {
      abortAll(`Request timeout after ${timeoutMs}ms`);
    }, Math.max(1, timeoutMs));

    if (body !== null && body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

/**
 * SSRF-safe HTTP/HTTPS fetch using Node core transport, DNS IP pinning,
 * manual redirect validation, decompression, byte cap, and deadline timeout.
 */
async function safeFetch(
  rawUrl,
  {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    _dnsLookup,
  } = {}
) {
  const start = Date.now();
  const deadline = start + Math.max(1, timeoutMs);
  const dnsLookup = _dnsLookup || dnsPromises.lookup;

  let currentUrl = rawUrl;
  let currentMethod = String(method || 'GET').toUpperCase();
  let currentBody = body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsedUrl = isSafePublicUrl(currentUrl);
    if (!parsedUrl) {
      return makeErrorResult(currentUrl, `Blocked unsafe URL: ${currentUrl}`);
    }

    let addresses;
    try {
      addresses = await resolveAndValidateHost(parsedUrl.hostname, dnsLookup);
    } catch (err) {
      return makeErrorResult(parsedUrl.toString(), err.message || 'DNS validation failed');
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      return makeErrorResult(parsedUrl.toString(), `Request timeout after ${timeoutMs}ms`);
    }

    const res = await executeSingleHttpRequest(parsedUrl, addresses, {
      method: currentMethod,
      headers,
      body: currentBody,
      timeoutMs: remainingMs,
      maxBytes,
    });

    if (!res.redirect) {
      return res;
    }

    if (hop >= maxRedirects) {
      return makeErrorResult(parsedUrl.toString(), `Too many redirects (>${maxRedirects})`, {
        status: res.status,
        headers: res.headers,
        finalUrl: parsedUrl.toString(),
      });
    }

    let nextUrl;
    try {
      nextUrl = new URL(res.location, parsedUrl).toString();
    } catch {
      return makeErrorResult(parsedUrl.toString(), `Invalid redirect Location: ${res.location}`, {
        status: res.status,
        headers: res.headers,
      });
    }

    if (
      res.status === 303 ||
      ((res.status === 301 || res.status === 302) && !['GET', 'HEAD'].includes(currentMethod))
    ) {
      currentMethod = 'GET';
      currentBody = null;
    }

    currentUrl = nextUrl;
  }

  return makeErrorResult(currentUrl, `Too many redirects (>${maxRedirects})`);
}

/**
 * Detect Cloudflare, Akamai, DataDome, or CAPTCHA bot-blocking challenges.
 * @param {number} status
 * @param {Record<string, string>|Headers} headers
 * @param {string} text
 * @returns {boolean}
 */
function detectBotBlock(status, headers = {}, text = '') {
  const normHeaders = normalizeHeaders(headers);
  const body = String(text || '').toLowerCase();

  // Cloudflare mitigation header is definitive regardless of status code
  if (normHeaders['cf-mitigated']) {
    return true;
  }

  const setCookie = normHeaders['set-cookie'] || '';
  const server = (normHeaders['server'] || '').toLowerCase();

  // Definitive interstitial challenge pages even on 200
  if (
    body.includes('challenges.cloudflare.com/turnstile') ||
    body.includes('geo.captcha-delivery.com') ||
    (body.includes('just a moment...') && (body.includes('cloudflare') || body.includes('_cf_chl')))
  ) {
    return true;
  }

  if (status === 429) {
    return true;
  }

  if (status === 403 || status === 503) {
    if (
      normHeaders['x-datadome'] ||
      normHeaders['x-datadome-cid'] ||
      setCookie.includes('datadome=') ||
      setCookie.includes('_abck=') ||
      setCookie.includes('ak_bmsc=')
    ) {
      return true;
    }

    const signatures = [
      'cf-turnstile',
      'cf-chl-bypass',
      '__cf_chl',
      'challenges.cloudflare.com',
      'attention required! | cloudflare',
      'just a moment',
      '_abck',
      'ak_bmsc',
      'datadome',
      'captcha-delivery.com',
      '_incapsula_resource',
      'incapsula incident id',
      'px-captcha',
      '_pxhd',
      'g-recaptcha',
      'h-captcha',
      'hcaptcha.com',
      'recaptcha/api.js',
      'verify you are human',
      'are you a robot',
      'bot protection',
      'access denied',
    ];

    if (signatures.some((sig) => body.includes(sig))) {
      return true;
    }

    if (server.includes('cloudflare') && status === 403) {
      return true;
    }
  }

  return false;
}

/**
 * Per-store circuit breaker with CLOSED, OPEN, and HALF_OPEN states.
 * Trips on 3 consecutive bot_blocked/timeout/network_error failures
 * or 4 parse_drift failures within the last 10 outcomes.
 */
function createCircuitBreaker() {
  const stores = new Map();

  function getOrCreate(storeId) {
    const id = String(storeId || 'unknown');
    if (!stores.has(id)) {
      stores.set(id, {
        storeId: id,
        state: 'CLOSED',
        consecutiveFailures: 0,
        recentOutcomes: [],
        openedAt: 0,
        cooldownUntil: 0,
        lastFailureKind: null,
        lastError: null,
        lastSuccessAt: null,
        lastFailureAt: null,
        lastLatencyMs: null,
        totalLatencyMs: 0,
        successCount: 0,
        failureCount: 0,
      });
    }
    return stores.get(id);
  }

  function trip(entry, kind, detail, now) {
    const cooldown = COOLDOWN_MS[kind] || COOLDOWN_MS.network_error;
    entry.state = 'OPEN';
    entry.openedAt = now;
    entry.cooldownUntil = now + cooldown;
    entry.lastFailureKind = kind;
    entry.lastError = detail || kind;
  }

  function pushOutcome(entry, outcome) {
    entry.recentOutcomes.push(outcome);
    if (entry.recentOutcomes.length > PARSE_DRIFT_WINDOW) {
      entry.recentOutcomes.shift();
    }
  }

  function formatHealth(entry, now = Date.now()) {
    let state = entry.state;
    if (state === 'OPEN' && now >= entry.cooldownUntil) {
      state = 'HALF_OPEN';
    }
    const parseDriftCount = entry.recentOutcomes.filter((x) => x === 'parse_drift').length;
    const cooldownRemainingMs = state === 'OPEN' ? Math.max(0, entry.cooldownUntil - now) : 0;
    const avgLatencyMs =
      entry.successCount > 0 ? Math.round(entry.totalLatencyMs / entry.successCount) : null;

    return {
      storeId: entry.storeId,
      state,
      consecutiveFailures: entry.consecutiveFailures,
      parseDriftCount,
      successCount: entry.successCount,
      failureCount: entry.failureCount,
      lastFailureKind: entry.lastFailureKind,
      lastError: entry.lastError,
      lastSuccessAt: entry.lastSuccessAt,
      lastFailureAt: entry.lastFailureAt,
      cooldownUntil: entry.cooldownUntil || null,
      cooldownRemainingMs,
      lastLatencyMs: entry.lastLatencyMs,
      avgLatencyMs,
    };
  }

  return {
    canRequest(storeId) {
      const entry = getOrCreate(storeId);
      const now = Date.now();
      if (entry.state === 'CLOSED' || entry.state === 'HALF_OPEN') {
        return true;
      }
      if (now >= entry.cooldownUntil) {
        entry.state = 'HALF_OPEN';
        return true;
      }
      return false;
    },

    recordSuccess(storeId, latencyMs = 0) {
      const entry = getOrCreate(storeId);
      const now = Date.now();
      const safeLatency = Number.isFinite(latencyMs) && latencyMs >= 0 ? Math.round(latencyMs) : 0;

      entry.state = 'CLOSED';
      entry.consecutiveFailures = 0;
      entry.openedAt = 0;
      entry.cooldownUntil = 0;
      entry.lastSuccessAt = now;
      entry.lastLatencyMs = safeLatency;
      entry.totalLatencyMs += safeLatency;
      entry.successCount += 1;
      pushOutcome(entry, 'success');
    },

    recordFailure(storeId, kind = 'network_error', detail = '') {
      const entry = getOrCreate(storeId);
      const now = Date.now();
      const normKind = COOLDOWN_MS[kind] ? kind : 'network_error';

      entry.failureCount += 1;
      entry.lastFailureKind = normKind;
      entry.lastError = detail ? String(detail) : normKind;
      entry.lastFailureAt = now;
      pushOutcome(entry, normKind);

      if (entry.state === 'HALF_OPEN') {
        if (CONSECUTIVE_FAILURE_KINDS.has(normKind)) {
          entry.consecutiveFailures += 1;
        }
        trip(entry, normKind, entry.lastError, now);
        return;
      }

      if (normKind === 'parse_drift') {
        const driftCount = entry.recentOutcomes.filter((x) => x === 'parse_drift').length;
        if (driftCount >= PARSE_DRIFT_TRIP_THRESHOLD) {
          trip(entry, 'parse_drift', entry.lastError, now);
        }
        return;
      }

      entry.consecutiveFailures += 1;
      if (entry.consecutiveFailures >= CONSECUTIVE_TRIP_THRESHOLD) {
        trip(entry, normKind, entry.lastError, now);
      }
    },

    getStoreHealth(storeId) {
      const entry = getOrCreate(storeId);
      return formatHealth(entry);
    },

    getAllHealth() {
      const now = Date.now();
      const out = {};
      for (const [id, entry] of stores.entries()) {
        out[id] = formatHealth(entry, now);
      }
      return out;
    },

    reset() {
      stores.clear();
    },
  };
}

const circuitBreaker = createCircuitBreaker();

let impitLoadAttempted = false;
let impitClient = null;

function getImpitClient() {
  if (impitLoadAttempted) return impitClient;
  impitLoadAttempted = true;
  try {
    const { Impit } = require('impit');
    impitClient = new Impit({ browser: 'chrome', followRedirects: false });
  } catch {
    impitClient = null;
  }
  return impitClient;
}

/**
 * Fetch via impit with pre-DNS SSRF validation, manual redirect checking,
 * timeout enforcement, and streaming maxBytes cap.
 */
async function fetchWithImpit(
  client,
  rawUrl,
  {
    method = 'GET',
    headers = {},
    body = null,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBytes = DEFAULT_MAX_BYTES,
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    _dnsLookup,
  } = {}
) {
  const deadline = Date.now() + Math.max(1, timeoutMs);
  const dnsLookup = _dnsLookup || dnsPromises.lookup;

  let currentUrl = rawUrl;
  let currentMethod = String(method || 'GET').toUpperCase();
  let currentBody = body;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const parsedUrl = isSafePublicUrl(currentUrl);
    if (!parsedUrl) {
      const err = createSsrfError(`Blocked unsafe URL: ${currentUrl}`);
      err.fatalSecurity = true;
      throw err;
    }

    try {
      await resolveAndValidateHost(parsedUrl.hostname, dnsLookup);
    } catch (err) {
      if (err && err.code === 'ERR_SSRF_BLOCKED') {
        err.fatalSecurity = true;
      }
      throw err;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      const err = new Error(`Request timeout after ${timeoutMs}ms`);
      err.isTimeout = true;
      throw err;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remainingMs);

    let response;
    try {
      response = await client.fetch(parsedUrl.toString(), {
        method: currentMethod,
        headers,
        body: currentBody ?? undefined,
        timeout: remainingMs,
        signal: controller.signal,
        redirect: 'manual',
      });
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted || (err && /timeout/i.test(err.name || err.message || ''))) {
        const timeoutErr = new Error(`Request timeout after ${timeoutMs}ms`);
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw err;
    }

    const status = response.status;
    const resHeaders = normalizeHeaders(response.headers);

    if (REDIRECT_STATUSES.has(status) && resHeaders.location) {
      clearTimeout(timer);
      try {
        response.abort();
      } catch {}

      if (hop >= maxRedirects) {
        return makeErrorResult(parsedUrl.toString(), `Too many redirects (>${maxRedirects})`, {
          status,
          headers: resHeaders,
          finalUrl: parsedUrl.toString(),
        });
      }

      let nextUrl;
      try {
        nextUrl = new URL(resHeaders.location, parsedUrl).toString();
      } catch {
        return makeErrorResult(parsedUrl.toString(), `Invalid redirect Location: ${resHeaders.location}`, {
          status,
          headers: resHeaders,
        });
      }

      if (
        status === 303 ||
        ((status === 301 || status === 302) && !['GET', 'HEAD'].includes(currentMethod))
      ) {
        currentMethod = 'GET';
        currentBody = null;
      }

      currentUrl = nextUrl;
      continue;
    }

    const contentLength = Number(resHeaders['content-length']);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      clearTimeout(timer);
      try {
        response.abort();
      } catch {}
      return makeErrorResult(
        parsedUrl.toString(),
        `Response Content-Length (${contentLength}) exceeded maxBytes (${maxBytes})`,
        { status, headers: resHeaders, finalUrl: parsedUrl.toString() }
      );
    }

    let totalBytes = 0;
    const chunks = [];
    try {
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            totalBytes += value.byteLength;
            if (totalBytes > maxBytes) {
              try {
                await reader.cancel();
              } catch {}
              try {
                response.abort();
              } catch {}
              clearTimeout(timer);
              return makeErrorResult(
                parsedUrl.toString(),
                `Response exceeded maxBytes limit (${maxBytes})`,
                { status, headers: resHeaders, finalUrl: parsedUrl.toString(), bytes: totalBytes }
              );
            }
            chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          }
        }
      } else {
        const ab = await response.arrayBuffer();
        totalBytes = ab.byteLength;
        if (totalBytes > maxBytes) {
          clearTimeout(timer);
          return makeErrorResult(parsedUrl.toString(), `Response exceeded maxBytes limit (${maxBytes})`, {
            status,
            headers: resHeaders,
            finalUrl: parsedUrl.toString(),
            bytes: totalBytes,
          });
        }
        chunks.push(Buffer.from(ab));
      }
    } catch (err) {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        const timeoutErr = new Error(`Request timeout after ${timeoutMs}ms`);
        timeoutErr.isTimeout = true;
        throw timeoutErr;
      }
      throw err;
    }

    clearTimeout(timer);
    const text = Buffer.concat(chunks).toString('utf8');
    const json = tryParseJson(text, resHeaders['content-type']);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: resHeaders,
      text,
      json,
      finalUrl: response.url || parsedUrl.toString(),
      bytes: totalBytes,
      error: null,
    };
  }

  return makeErrorResult(currentUrl, `Too many redirects (>${maxRedirects})`);
}

/**
 * Store-aware HTTP fetch combining SSRF checks, circuitBreaker gating,
 * lazy impit browser TLS impersonation (with safeFetch fallback), and bot-block detection.
 */
async function storeFetch(storeId, rawUrl, opts = {}) {
  const start = Date.now();
  const useImpit = opts.useImpit !== false;
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!isSafePublicUrl(rawUrl)) {
    return {
      ok: false,
      status: 0,
      headers: {},
      text: '',
      json: null,
      finalUrl: rawUrl,
      botBlocked: false,
      transport: 'safeFetch',
      latencyMs: 0,
      error: `Blocked unsafe URL: ${rawUrl}`,
    };
  }

  if (!circuitBreaker.canRequest(storeId)) {
    return {
      ok: false,
      status: 0,
      headers: {},
      text: '',
      json: null,
      finalUrl: rawUrl,
      botBlocked: false,
      transport: 'safeFetch',
      latencyMs: 0,
      error: `Circuit breaker OPEN for store ${storeId}`,
    };
  }

  let res = null;
  let transport = 'safeFetch';
  const impit = useImpit ? getImpitClient() : null;

  if (impit) {
    try {
      res = await fetchWithImpit(impit, rawUrl, { ...opts, maxBytes, timeoutMs });
      transport = 'impit';
    } catch (err) {
      if (err && err.fatalSecurity) {
        return {
          ok: false,
          status: 0,
          headers: {},
          text: '',
          json: null,
          finalUrl: rawUrl,
          botBlocked: false,
          transport: 'impit',
          latencyMs: Date.now() - start,
          error: err.message,
        };
      }
      if (err && err.isTimeout) {
        const latencyMs = Date.now() - start;
        circuitBreaker.recordFailure(storeId, 'timeout', err.message);
        return {
          ok: false,
          status: 0,
          headers: {},
          text: '',
          json: null,
          finalUrl: rawUrl,
          botBlocked: false,
          transport: 'impit',
          latencyMs,
          error: err.message,
        };
      }
      // Native/protocol error from impit falls back to safeFetch within remaining budget
      const remainingMs = Math.max(250, timeoutMs - (Date.now() - start));
      res = await safeFetch(rawUrl, { ...opts, maxBytes, timeoutMs: remainingMs });
      transport = 'safeFetch';
    }
  } else {
    res = await safeFetch(rawUrl, { ...opts, maxBytes, timeoutMs });
    transport = 'safeFetch';
  }

  const latencyMs = Date.now() - start;
  const botBlocked = detectBotBlock(res.status, res.headers, res.text);

  if (botBlocked) {
    circuitBreaker.recordFailure(storeId, 'bot_blocked', `HTTP ${res.status} bot challenge`);
  } else if (res.error && /timeout/i.test(res.error)) {
    circuitBreaker.recordFailure(storeId, 'timeout', res.error);
  } else if (res.status === 0 && res.error && !/blocked unsafe|non-public ip/i.test(res.error)) {
    circuitBreaker.recordFailure(storeId, 'network_error', res.error);
  } else if (res.status === 502 || res.status === 504) {
    circuitBreaker.recordFailure(storeId, 'network_error', `HTTP ${res.status}`);
  } else if (res.ok) {
    circuitBreaker.recordSuccess(storeId, latencyMs);
  }

  return {
    ok: Boolean(res.ok && !botBlocked),
    status: res.status || 0,
    headers: res.headers || {},
    text: res.text || '',
    json: res.json ?? null,
    finalUrl: res.finalUrl || rawUrl,
    botBlocked,
    transport,
    latencyMs,
    error: botBlocked ? res.error || `Bot protection detected (HTTP ${res.status})` : res.error || null,
  };
}

module.exports = {
  isSafePublicUrl,
  isPublicIp,
  safeFetch,
  detectBotBlock,
  circuitBreaker,
  createCircuitBreaker,
  storeFetch,
};
