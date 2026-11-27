'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DB_PATH = path.join(process.cwd(), 'data', 'frugal-radar.sqlite');
const DEFAULT_MAX_MEMORY_ENTRIES = 500;
const DEFAULT_FRESH_MS = 10 * 60 * 1000;
const PRICE_DEDUP_WINDOW_MS = 6 * 60 * 60 * 1000;

function tryOpenSqlite(dbPath) {
  if (dbPath === null || dbPath === false) {
    return null;
  }

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return null;
  }

  if (typeof DatabaseSync !== 'function') {
    return null;
  }

  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);
  let walMode = false;

  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
      db.exec('PRAGMA busy_timeout = 3000;');
      walMode = true;
    } catch {
      walMode = false;
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS cache_entries (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      fresh_until INTEGER NOT NULL,
      stale_until INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_product_key TEXT NOT NULL,
      store_id TEXT NOT NULL,
      title TEXT,
      price REAL NOT NULL,
      url TEXT,
      observed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_price_history_key_time
      ON price_history(store_product_key, observed_at);
  `);

  return { db, walMode };
}

function computeStatsFromRows(rows) {
  if (!rows || rows.length === 0) {
    return null;
  }

  let minPrice = Infinity;
  let maxPrice = -Infinity;
  for (const row of rows) {
    if (row.price < minPrice) minPrice = row.price;
    if (row.price > maxPrice) maxPrice = row.price;
  }

  const latest = rows[rows.length - 1];
  const prev = rows.length >= 2 ? rows[rows.length - 2] : null;
  const priceDelta = prev ? Number((latest.price - prev.price).toFixed(2)) : 0;

  return {
    lastPrice: latest.price,
    minPrice,
    maxPrice,
    priceDelta,
    observations: rows.length,
  };
}

/**
 * Create a SWR + single-flight cache backed by node:sqlite (WAL) with automatic
 * fallback to a bounded in-memory LRU + price history store on Node <22.5.
 */
function createCache({ dbPath = DEFAULT_DB_PATH, maxMemoryEntries = DEFAULT_MAX_MEMORY_ENTRIES } = {}) {
  const maxEntries = Math.max(1, Number(maxMemoryEntries) || DEFAULT_MAX_MEMORY_ENTRIES);
  const sqliteInfo = tryOpenSqlite(dbPath);
  const db = sqliteInfo ? sqliteInfo.db : null;
  const walMode = sqliteInfo ? sqliteInfo.walMode : false;

  const memoryCache = new Map();
  const memoryPriceHistory = new Map();
  const inFlight = new Map();

  let stmts = null;
  if (db) {
    stmts = {
      getEntry: db.prepare(
        'SELECT value_json, fresh_until, stale_until, updated_at FROM cache_entries WHERE key = ?'
      ),
      upsertEntry: db.prepare(`
        INSERT INTO cache_entries (key, value_json, fresh_until, stale_until, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          fresh_until = excluded.fresh_until,
          stale_until = excluded.stale_until,
          updated_at = excluded.updated_at
      `),
      deleteEntry: db.prepare('DELETE FROM cache_entries WHERE key = ?'),
      getHistory: db.prepare(
        'SELECT price, observed_at FROM price_history WHERE store_product_key = ? ORDER BY observed_at ASC, id ASC'
      ),
      insertHistory: db.prepare(`
        INSERT INTO price_history (store_product_key, store_id, title, price, url, observed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
    };
  }

  function touchLru(key, record) {
    memoryCache.delete(key);
    memoryCache.set(key, record);
    while (memoryCache.size > maxEntries) {
      const oldestKey = memoryCache.keys().next().value;
      memoryCache.delete(oldestKey);
    }
  }

  function get(key) {
    const now = Date.now();
    if (db) {
      const row = stmts.getEntry.get(key);
      if (!row) return null;
      if (now > row.stale_until) {
        stmts.deleteEntry.run(key);
        return null;
      }
      let value;
      try {
        value = JSON.parse(row.value_json);
      } catch {
        stmts.deleteEntry.run(key);
        return null;
      }
      return {
        value,
        isFresh: now <= row.fresh_until,
        isStale: now > row.fresh_until && now <= row.stale_until,
        freshUntil: row.fresh_until,
        staleUntil: row.stale_until,
        updatedAt: row.updated_at,
      };
    }

    const record = memoryCache.get(key);
    if (!record) return null;
    if (now > record.staleUntil) {
      memoryCache.delete(key);
      return null;
    }
    touchLru(key, record);
    return {
      value: record.value,
      isFresh: now <= record.freshUntil,
      isStale: now > record.freshUntil && now <= record.staleUntil,
      freshUntil: record.freshUntil,
      staleUntil: record.staleUntil,
      updatedAt: record.updatedAt,
    };
  }

  function set(key, value, { freshMs = DEFAULT_FRESH_MS, staleMs } = {}) {
    const now = Date.now();
    const safeFreshMs = Math.max(0, Number(freshMs) || 0);
    const safeStaleMs =
      staleMs === undefined ? safeFreshMs : Math.max(safeFreshMs, Number(staleMs) || 0);
    const freshUntil = now + safeFreshMs;
    const staleUntil = now + safeStaleMs;

    if (db) {
      stmts.upsertEntry.run(key, JSON.stringify(value), freshUntil, staleUntil, now);
    } else {
      touchLru(key, { value, freshUntil, staleUntil, updatedAt: now });
    }

    return {
      value,
      freshUntil,
      staleUntil,
      updatedAt: now,
    };
  }

  function runSingleFlight(key, fetcher, { freshMs, staleMs, negativeMs, isBackground }) {
    if (inFlight.has(key)) {
      return inFlight.get(key);
    }

    const promise = (async () => {
      try {
        const result = await fetcher();
        if (result === null || result === undefined) {
          if (negativeMs > 0) {
            set(
              key,
              { __negativeCache: true, error: null },
              { freshMs: negativeMs, staleMs: negativeMs }
            );
          }
          return {
            value: null,
            status: 'MISS',
            cachedAt: Date.now(),
            freshUntil: Date.now() + negativeMs,
            staleUntil: Date.now() + negativeMs,
          };
        }

        const stored = set(key, result, { freshMs, staleMs });
        return {
          value: stored.value,
          status: 'MISS',
          cachedAt: stored.updatedAt,
          freshUntil: stored.freshUntil,
          staleUntil: stored.staleUntil,
        };
      } catch (err) {
        if (!isBackground && negativeMs > 0) {
          set(
            key,
            { __negativeCache: true, error: err && err.message ? err.message : 'Fetch failed' },
            { freshMs: negativeMs, staleMs: negativeMs }
          );
        }
        throw err;
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, promise);
    return promise;
  }

  async function getOrFetch(
    key,
    fetcher,
    {
      freshMs = DEFAULT_FRESH_MS,
      staleMs,
      negativeMs = 60 * 1000,
      forceRefresh = false,
    } = {}
  ) {
    if (!forceRefresh) {
      const existing = get(key);
      if (existing) {
        const isNegative =
          existing.value &&
          typeof existing.value === 'object' &&
          existing.value.__negativeCache === true;

        if (isNegative) {
          if (existing.isFresh) {
            return {
              value: null,
              status: 'NEGATIVE_HIT',
              cachedAt: existing.updatedAt,
              freshUntil: existing.freshUntil,
              staleUntil: existing.staleUntil,
              error: existing.value.error || null,
            };
          }
        } else if (existing.isFresh) {
          return {
            value: existing.value,
            status: 'HIT',
            cachedAt: existing.updatedAt,
            freshUntil: existing.freshUntil,
            staleUntil: existing.staleUntil,
          };
        } else if (existing.isStale) {
          // Serve stale data immediately while refreshing in the background
          runSingleFlight(key, fetcher, {
            freshMs,
            staleMs,
            negativeMs,
            isBackground: true,
          }).catch(() => {});

          return {
            value: existing.value,
            status: 'STALE',
            cachedAt: existing.updatedAt,
            freshUntil: existing.freshUntil,
            staleUntil: existing.staleUntil,
          };
        }
      }
    }

    return runSingleFlight(key, fetcher, {
      freshMs,
      staleMs,
      negativeMs,
      isBackground: false,
    });
  }

  function recordPriceObservation({ storeProductKey, storeId, title = '', price, url = '', observedAt } = {}) {
    if (!storeProductKey || typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return null;
    }

    const now = Number.isFinite(observedAt) ? observedAt : Date.now();
    const normPrice = Number(price.toFixed(2));
    const normStoreId = String(storeId || 'unknown');

    if (db) {
      const existingRows = stmts.getHistory.all(storeProductKey);
      const latest = existingRows.length > 0 ? existingRows[existingRows.length - 1] : null;
      const unchangedWithinWindow =
        latest &&
        Math.abs(latest.price - normPrice) < 0.005 &&
        now - latest.observed_at >= 0 &&
        now - latest.observed_at < PRICE_DEDUP_WINDOW_MS;

      if (!unchangedWithinWindow) {
        stmts.insertHistory.run(
          storeProductKey,
          normStoreId,
          String(title || ''),
          normPrice,
          String(url || ''),
          now
        );
        existingRows.push({ price: normPrice, observed_at: now });
      }
      return computeStatsFromRows(existingRows);
    }

    if (!memoryPriceHistory.has(storeProductKey)) {
      memoryPriceHistory.set(storeProductKey, []);
    }
    const rows = memoryPriceHistory.get(storeProductKey);
    const latest = rows.length > 0 ? rows[rows.length - 1] : null;
    const unchangedWithinWindow =
      latest &&
      Math.abs(latest.price - normPrice) < 0.005 &&
      now - latest.observed_at >= 0 &&
      now - latest.observed_at < PRICE_DEDUP_WINDOW_MS;

    if (!unchangedWithinWindow) {
      rows.push({
        store_product_key: storeProductKey,
        store_id: normStoreId,
        title: String(title || ''),
        price: normPrice,
        url: String(url || ''),
        observed_at: now,
      });
    }

    return computeStatsFromRows(rows);
  }

  function getPriceStats(storeProductKey) {
    if (!storeProductKey) return null;
    if (db) {
      const rows = stmts.getHistory.all(storeProductKey);
      return computeStatsFromRows(rows);
    }
    const rows = memoryPriceHistory.get(storeProductKey);
    return computeStatsFromRows(rows);
  }

  function getBackendInfo() {
    return {
      backend: db ? 'sqlite' : 'memory',
      dbPath: db ? dbPath : null,
      walMode,
      maxMemoryEntries: maxEntries,
    };
  }

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    inFlight.clear();
    memoryCache.clear();
    memoryPriceHistory.clear();
    if (db) {
      try {
        db.close();
      } catch {}
    }
  }

  return {
    get,
    set,
    getOrFetch,
    recordPriceObservation,
    getPriceStats,
    getBackendInfo,
    close,
  };
}

let defaultCacheInstance = null;

const cache = new Proxy(
  {},
  {
    get(_target, prop) {
      if (!defaultCacheInstance) {
        defaultCacheInstance = createCache({ dbPath: DEFAULT_DB_PATH });
      }
      const value = defaultCacheInstance[prop];
      return typeof value === 'function' ? value.bind(defaultCacheInstance) : value;
    },
  }
);

module.exports = {
  createCache,
  cache,
};
