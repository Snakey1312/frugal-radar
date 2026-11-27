const { URL } = require('node:url');
const { isSafePublicUrl, storeFetch, circuitBreaker } = require('./http-client');
const { cache } = require('./cache');
const {
  detectCategory,
  extractAttributes,
  scoreCandidate,
  canonicalizeUrl,
  extractStoreProductKey,
  buildClusterKey,
  distillQuery,
} = require('./matching');
const {
  extractMetadataFromHtml,
  extractPriceFromHtml,
  extractStockAndSizesFromHtml,
} = require('./extractors');
const {
  loadStores,
  resolveStore,
  runStoreAdapters,
  searchSerperShoppingRo,
  searchBingShoppingRo,
} = require('./adapters');
const {
  SIZED_CATEGORIES,
  rankOffers,
  computeSourceComparison,
} = require('../public/cost-calculator');

const STAGE1_DEADLINE_MS = 4000;
const STAGE2_DEADLINE_MS = 4500;
const STAGE2_CONCURRENCY = 4;
const STAGE2_MAX_URLS = 6;
const CHECK_STOCK_DEADLINE_MS = 3000;
const CHECK_STOCK_MAX_URLS = 6;

// Bing cards carry a price but no stock verdict. A few Romanian storefronts
// still serve their product pages to serverless egress, so those offers can be
// promoted from "check on site" to a real live stock verification.
const LIVE_STOCK_BING_HOST_RE = /(?:^|\.)(?:beststoreonline\.ro|vivantis\.ro|pepita\.com)$/i;

function withDeadline(promise, ms, fallbackValue) {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallbackValue), ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    timeoutPromise,
  ]);
}

async function runPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIdx = 0;

  async function runWorker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function buildShippingProfile(store) {
  const shipping = store?.shipping || {};
  return {
    channels: shipping.channels || {
      easybox: { available: true, fee: shipping.easyboxFee ?? 14.99, freeThreshold: shipping.freeThreshold ?? 250, requiresOnlinePay: false },
      fanbox: { available: false },
      courier: { available: true, fee: shipping.baseFee ?? 19.99, freeThreshold: shipping.freeThreshold ?? 250, requiresOnlinePay: false },
      clickAndCollect: { available: false },
    },
    bulkyPolicy: shipping.bulkyPolicy || 'standard',
    deliveryDays: shipping.deliveryDays || { min: 2, max: 4 },
    membershipProgram: shipping.membershipProgram || null,
  };
}

function buildPaymentProfile(store) {
  const shipping = store?.shipping || {};
  const payment = store?.payment || {};
  return {
    cardOnline: payment.cardOnline !== false,
    ramburs: payment.ramburs || {
      allowed: true,
      fee: shipping.rambursFee ?? 5.0,
      nonRefundableOnReturn: false,
      maxOrderRon: 5000,
      maxWeightKg: null,
      disablesFreeShipping: false,
    },
  };
}

function normalizeExplicitSize(value) {
  return String(value || '')
    .replace(',', '.')
    .replace(/[_/]?1[_/]?2\b/, '.5')
    .trim()
    .toLowerCase();
}

function isAdultFootwearSize(size) {
  const n = parseFloat(normalizeExplicitSize(size));
  return Number.isFinite(n) && n >= 35 && n <= 50;
}

function isKidsFootwearListing(title) {
  const raw = String(title || '');
  return /\b(?:kids?|copii|copil|junior|youth|grade school|toddler|infant)\b/i.test(raw)
    || /\b\d{1,2}(?:\.\d)?\s?y\b/i.test(raw);
}

function hasExplicitDifferentSize(title, desiredSize) {
  if (!desiredSize) return false;
  const target = normalizeExplicitSize(desiredSize);
  const raw = String(title || '');
  const patterns = [
    /\b(?:gr|größe|groesse|size|marimea|mărimea|nr)\.?\s*(\d{2}(?:[._,\/]*1[._,\/]*2|[.,]5)?)/i,
    /\b(\d{2}(?:[._,\/]*1[._,\/]*2|[.,]5)?)\s*(?:eur|eu)\b/i,
    /\b(\d{2}[.,]5)\b/,
  ];
  for (const re of patterns) {
    const match = raw.match(re);
    if (match && normalizeExplicitSize(match[1]) !== target) return true;
  }
  return false;
}

function extractSlugFromUrl(parsedUrl) {
  const segments = parsedUrl.pathname
    .split('/')
    .filter((s) => s && !['pd', 'p', 'produs', 'product', 'ro', 'cautare', 'search'].includes(s.toLowerCase()));
  const longest = segments.sort((a, b) => b.length - a.length)[0] || parsedUrl.hostname;
  return longest
    .replace(/\.html?$/i, '')
    .replace(/-[a-z0-9]{6,}$/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function normalizeInitialStock(match, category, desiredSize) {
  const isSized = SIZED_CATEGORIES.includes(category);
  const existing = match.stock;

  if (match.inStock === false || existing?.verificationState === 'verified_out_of_stock') {
    return {
      requiresSize: isSized,
      verificationState: 'verified_out_of_stock',
      status: 'out_of_stock',
      label: 'Stoc epuizat',
      availableSizes: Array.isArray(existing?.availableSizes) ? existing.availableSizes : [],
      hasDesiredSize: false,
      isVerified: true,
    };
  }

  if (existing && existing.verificationState === 'verified_in_stock') {
    if (isSized && desiredSize) {
      const target = desiredSize.toUpperCase();
      const sizes = Array.isArray(existing.availableSizes) ? existing.availableSizes.map((s) => String(s).toUpperCase()) : [];
      if (sizes.length > 0) {
        const has = sizes.includes(target);
        return {
          requiresSize: true,
          verificationState: has ? 'verified_in_stock' : 'verified_out_of_stock',
          status: has ? 'in_stock' : 'out_of_stock',
          label: has ? `În stoc (${target})` : `Epuizat mărimea ${target}`,
          availableSizes: sizes,
          hasDesiredSize: has,
          isVerified: true,
        };
      }
    } else if (!isSized) {
      return {
        requiresSize: false,
        verificationState: 'verified_in_stock',
        status: 'in_stock',
        label: existing.label || 'În stoc',
        availableSizes: [],
        hasDesiredSize: true,
        isVerified: true,
      };
    }
  }

  if (isSized && desiredSize && match.url) {
    const urlSizeMatch = String(match.url).match(/marime-(\d{2}(?:[.-]5)?|xs|s|m|l|xl|xxl)\b/i);
    if (urlSizeMatch) {
      const foundSize = urlSizeMatch[1].replace('-', '.').toUpperCase();
      const target = desiredSize.toUpperCase();
      const has = foundSize === target;
      return {
        requiresSize: true,
        verificationState: has ? 'verified_in_stock' : 'verified_out_of_stock',
        status: has ? 'in_stock' : 'out_of_stock',
        label: has ? `În stoc (${target})` : `Doar mărimea ${foundSize}`,
        availableSizes: [foundSize],
        hasDesiredSize: has,
        isVerified: true,
      };
    }
  }

  if (!isSized && match.inStock === true && match.priceSource === 'tier2_live' && match.price > 0) {
    return {
      requiresSize: false,
      verificationState: 'verified_in_stock',
      status: 'in_stock',
      label: 'În stoc (Verificat)',
      availableSizes: [],
      hasDesiredSize: true,
      isVerified: true,
    };
  }

  return {
    requiresSize: isSized,
    verificationState: 'unverified_unknown',
    status: isSized && desiredSize ? 'select_size' : 'unverified',
    label: isSized && desiredSize ? `Verifică mărimea ${desiredSize} pe site` : 'Verifică stocul pe site',
    availableSizes: Array.isArray(existing?.availableSizes) ? existing.availableSizes : [],
    hasDesiredSize: null,
    isVerified: false,
  };
}

function mergeMarketplace(existingMp, incomingMp) {
  const a = existingMp || {};
  const b = incomingMp || {};
  return {
    sellerType: (b.sellerType && b.sellerType !== 'unknown') ? b.sellerType : (a.sellerType || 'unknown'),
    sellerName: b.sellerName || a.sellerName || null,
    isGeniusEligible: typeof b.isGeniusEligible === 'boolean' ? b.isGeniusEligible : (typeof a.isGeniusEligible === 'boolean' ? a.isGeniusEligible : null),
    isBulky: Boolean(a.isBulky || b.isBulky),
    overrideShippingFee: b.overrideShippingFee ?? a.overrideShippingFee ?? null,
    overrideFreeThreshold: b.overrideFreeThreshold ?? a.overrideFreeThreshold ?? null,
  };
}

function sourceRank(priceSource) {
  if (priceSource === 'tier2_live') return 3;
  if (priceSource === 'tier1_feed') return 2;
  if (priceSource === 'tier3_serper' || priceSource === 'tier3_bing') return 1;
  return 0;
}

function mergeDuplicateCandidate(existing, incoming) {
  const incomingPriceValid = typeof incoming.price === 'number' && incoming.price > 0;
  const existingPriceValid = typeof existing.price === 'number' && existing.price > 0;
  const preferIncomingPrice = incomingPriceValid && (
    !existingPriceValid || sourceRank(incoming.priceSource) > sourceRank(existing.priceSource)
  );

  const sources = Array.from(new Set([...(existing.sources || []), ...(incoming.sources || [])]));
  const betterStock = incoming.stock?.isVerified && !existing.stock?.isVerified
    ? incoming.stock
    : existing.stock;

  return {
    ...existing,
    title: (incoming.title && incoming.title.length > existing.title.length && sourceRank(incoming.priceSource) >= sourceRank(existing.priceSource))
      ? incoming.title
      : existing.title,
    url: sourceRank(incoming.priceSource) > sourceRank(existing.priceSource) ? incoming.url : existing.url,
    price: preferIncomingPrice ? incoming.price : existing.price,
    priceSource: preferIncomingPrice ? incoming.priceSource : existing.priceSource,
    needsPriceEnrichment: preferIncomingPrice ? false : (existing.needsPriceEnrichment && !incomingPriceValid),
    stock: betterStock,
    score: Math.max(existing.score || 0, incoming.score || 0),
    variantBucket: existing.variantBucket === 'exact_variant' || incoming.variantBucket !== 'exact_variant'
      ? existing.variantBucket
      : incoming.variantBucket,
    gtin: existing.gtin || incoming.gtin || null,
    mpn: existing.mpn || incoming.mpn || null,
    marketplace: mergeMarketplace(existing.marketplace, incoming.marketplace),
    sources,
  };
}

function buildStoreHealthList(stores) {
  const allHealth = circuitBreaker.getAllHealth() || {};
  return stores.map((store) => {
    const h = allHealth[store.id] || {
      state: 'CLOSED',
      consecutiveFailures: 0,
      lastFailureKind: null,
      cooldownRemainingMs: 0,
    };
    let uiState = 'healthy';
    if (h.state === 'OPEN') {
      if (h.lastFailureKind === 'bot_blocked') uiState = 'blocked';
      else if (h.lastFailureKind === 'parse_drift') uiState = 'parse_error';
      else uiState = 'degraded';
    } else if (h.state === 'HALF_OPEN' || (h.consecutiveFailures && h.consecutiveFailures > 0)) {
      uiState = 'degraded';
    } else if (store.ingestion?.liveVerifyCapable === false) {
      uiState = 'serper_or_manual';
    }

    return {
      storeId: store.id,
      storeName: store.name,
      state: uiState,
      circuitState: h.state || 'CLOSED',
      reason: h.lastFailureKind || (store.ingestion?.liveVerifyCapable === false ? 'anti_bot_guarded' : null),
      retryAfterSec: Math.ceil((h.cooldownRemainingMs || 0) / 1000),
      liveVerifyCapable: store.ingestion?.liveVerifyCapable !== false,
    };
  });
}

function selectStage2Candidates(candidates, category, desiredSize) {
  const isSized = SIZED_CATEGORIES.includes(category);
  const hasExactVariant = candidates.some((c) => c.variantBucket === 'exact_variant');

  const eligible = candidates.filter((c) => {
    // Even stores marked anti-bot-guarded are worth one attempt: storeFetch
    // detects blocks and the circuit breaker opens on repeated failures.
    if (!circuitBreaker.canRequest(c.storeId)) return false;
    if (c.stock.verificationState === 'verified_out_of_stock') return false;
    if (hasExactVariant && c.variantBucket === 'different_variant') return false;

    const needsPrice = !(typeof c.price === 'number' && c.price > 0) || c.needsPriceEnrichment;
    const needsSize = isSized && Boolean(desiredSize) && c.stock.verificationState === 'unverified_unknown';
    const needsBingStock = c.priceSource === 'tier3_bing'
      && c.stock.verificationState === 'unverified_unknown'
      && LIVE_STOCK_BING_HOST_RE.test(c.domain || '');
    return needsPrice || needsSize || needsBingStock;
  });

  const bucketRank = (bucket) => (bucket === 'exact_variant' ? 0 : bucket === 'unverified_variant' ? 1 : 2);

  eligible.sort((a, b) => {
    const bDiff = bucketRank(a.variantBucket) - bucketRank(b.variantBucket);
    if (bDiff !== 0) return bDiff;
    const aHasPrice = typeof a.price === 'number' && a.price > 0 ? 0 : 1;
    const bHasPrice = typeof b.price === 'number' && b.price > 0 ? 0 : 1;
    if (aHasPrice !== bHasPrice) return aHasPrice - bHasPrice;
    return (a.price || Number.MAX_SAFE_INTEGER) - (b.price || Number.MAX_SAFE_INTEGER);
  });

  // Breadth-first: 1 candidate per unique storeId inside exact_variant first, then remaining
  const picked = [];
  const pickedKeys = new Set();
  const seenStoreIds = new Set();

  for (const c of eligible) {
    if (c.variantBucket !== 'exact_variant') continue;
    if (!seenStoreIds.has(c.storeId)) {
      seenStoreIds.add(c.storeId);
      picked.push(c);
      pickedKeys.add(c.storeProductKey);
      if (picked.length >= STAGE2_MAX_URLS) return picked;
    }
  }

  for (const c of eligible) {
    if (pickedKeys.has(c.storeProductKey)) continue;
    picked.push(c);
    pickedKeys.add(c.storeProductKey);
    if (picked.length >= STAGE2_MAX_URLS) break;
  }

  return picked;
}

function evaluateStockFromSizes(availableSizes, desiredSize, baseStock) {
  if (!desiredSize || !Array.isArray(availableSizes) || availableSizes.length === 0) {
    return baseStock;
  }
  const target = desiredSize.toUpperCase();
  const normalized = availableSizes.map((s) => String(s).toUpperCase());
  const has = normalized.includes(target);
  return {
    requiresSize: true,
    verificationState: has ? 'verified_in_stock' : 'verified_out_of_stock',
    status: has ? 'in_stock' : 'out_of_stock',
    label: has ? `În stoc (${target})` : `Epuizat mărimea ${target}`,
    availableSizes: normalized,
    hasDesiredSize: has,
    isVerified: true,
  };
}

function buildCostOptions(params = {}) {
  const memberships = params.memberships || {
    emagGenius: params.geniusEmag ? (params.geniusEmag === 'light' ? 'light' : 'premium') : 'none',
    farmaciaTeiElite: Boolean(params.farmaciaTeiElite),
    sephoraGold: Boolean(params.sephoraGold),
  };
  return {
    deliveryType: params.deliveryType || 'easybox',
    paymentMethod: params.paymentMethod || 'card',
    memberships,
    voucherPercent: Number(params.voucherPercent) || 0,
    voucherStoreId: params.voucherStoreId || 'all',
  };
}

async function runSearchPipeline(params = {}, deps = {}) {
  const rawQuery = String(params.query || '').trim();
  if (rawQuery.length < 2) {
    const err = new Error('Introdu numele produsului (minim 2 caractere).');
    err.statusCode = 400;
    throw err;
  }

  const _cache = deps.cache || cache;
  const _runStoreAdapters = deps.runStoreAdapters || runStoreAdapters;
  const _searchSerper = deps.searchSerperShoppingRo || searchSerperShoppingRo;
  const _searchBing = deps.searchBingShoppingRo || searchBingShoppingRo;
  const _storeFetch = deps.storeFetch || storeFetch;
  const _loadStores = deps.loadStores || loadStores;
  const _resolveStore = deps.resolveStore || resolveStore;

  const detectedCategory = params.category && params.category !== 'auto'
    ? params.category
    : detectCategory(rawQuery);
  const queryAttrs = extractAttributes(rawQuery, detectedCategory);
  const cleanQuery = queryAttrs?.cleanQuery && queryAttrs.cleanQuery.length >= 2
    ? queryAttrs.cleanQuery
    : rawQuery;

  const isSized = SIZED_CATEGORIES.includes(detectedCategory);
  const desiredSize = isSized
    ? String(params.size || params.desiredSize || queryAttrs?.size || '').trim().toUpperCase()
    : '';
  const forceRefresh = Boolean(params.forceRefresh);
  const serperKey = String(params.serperKey || '').trim();

  // --- Stage 1 (4.0s deadline): parallel store adapters + Serper RO + Bing Shopping ---
  const [adapterRes, serperRes, bingRes] = await Promise.all([
    withDeadline(
      _runStoreAdapters(cleanQuery, detectedCategory, { cache: _cache, forceRefresh }).catch((err) => ({
        matches: [],
        error: err.message,
      })),
      STAGE1_DEADLINE_MS,
      { matches: [], timedOut: true }
    ),
    withDeadline(
      _searchSerper(cleanQuery, serperKey, { cache: _cache, forceRefresh }).catch((err) => ({
        matches: [],
        info: { used: Boolean(serperKey), shoppingCount: 0, webCount: 0, error: err.message },
      })),
      STAGE1_DEADLINE_MS,
      { matches: [], info: { used: Boolean(serperKey), shoppingCount: 0, webCount: 0, error: 'Serper deadline exceeded' } }
    ),
    withDeadline(
      _searchBing(cleanQuery, { cache: _cache, forceRefresh }).catch((err) => ({
        matches: [],
        info: { used: true, offerCount: 0, error: err.message },
      })),
      STAGE1_DEADLINE_MS,
      { matches: [], info: { used: true, offerCount: 0, error: 'Bing deadline exceeded' } }
    ),
  ]);

  const adapterMatches = Array.isArray(adapterRes) ? adapterRes : (adapterRes?.matches || []);
  const serperMatches = (serperRes?.matches || []).map((m) => ({
    ...m,
    priceSource: m.priceSource || 'tier3_serper',
  }));
  const bingMatches = (bingRes?.matches || []).map((m) => ({
    ...m,
    priceSource: m.priceSource || 'tier3_bing',
  }));
  const rawMatches = [...adapterMatches, ...serperMatches, ...bingMatches];

  // --- Filtering, Quality-Preserving Dedup & Clustering ---
  const dedupedByKey = new Map();

  for (const m of rawMatches) {
    if (!m || !m.url || !m.title) continue;
    const parsedSafe = isSafePublicUrl(m.url);
    if (!parsedSafe) continue;

    // An adult size request must not be answered with kids' sizes or with a
    // listing that explicitly advertises a different size in its title.
    if (SIZED_CATEGORIES.includes(detectedCategory) && desiredSize) {
      if (isAdultFootwearSize(desiredSize) && isKidsFootwearListing(m.title)) continue;
      if (hasExplicitDifferentSize(m.title, desiredSize)) continue;
    }

    const canonUrl = canonicalizeUrl(parsedSafe.toString());
    const scored = scoreCandidate(m.title, cleanQuery, {
      category: detectedCategory,
      price: typeof m.price === 'number' ? m.price : null,
    });
    if (scored?.rejected) continue;

    const resolvedStore = _resolveStore(m.storeId || m.customStoreName, canonUrl);
    const storeProductKey = extractStoreProductKey(canonUrl, resolvedStore.id);
    const priceNum = typeof m.price === 'number' && !Number.isNaN(m.price) && m.price > 0
      ? Number(m.price)
      : null;

    const candidate = {
      storeId: resolvedStore.id,
      storeName: resolvedStore.name || m.customStoreName || 'Magazin RO',
      domain: resolvedStore.domains?.[0] || resolvedStore.domain || parsedSafe.hostname.replace(/^www\./, ''),
      resolvedStore,
      storeProductKey,
      url: canonUrl,
      canonicalUrl: canonUrl,
      title: m.title,
      price: priceNum,
      priceSource: m.priceSource || (m.source === 'serper' ? 'tier3_serper' : 'tier2_live'),
      needsPriceEnrichment: Boolean(m.needsPriceEnrichment || !priceNum),
      stock: normalizeInitialStock(m, detectedCategory, desiredSize),
      score: typeof scored?.score === 'number' ? scored.score : 0.5,
      variantBucket: scored?.variantBucket || 'unverified_variant',
      unitPriceLabel: scored?.unitPriceLabel || null,
      attributes: scored?.attributes || {},
      gtin: m.gtin || null,
      mpn: m.mpn || null,
      marketplace: mergeMarketplace(null, m.marketplace),
      sources: [m.priceSource || (m.storeId ? 'adapter' : 'serper')],
    };

    if (dedupedByKey.has(storeProductKey)) {
      dedupedByKey.set(storeProductKey, mergeDuplicateCandidate(dedupedByKey.get(storeProductKey), candidate));
    } else {
      dedupedByKey.set(storeProductKey, candidate);
    }
  }

  const dedupedCandidates = Array.from(dedupedByKey.values());

  // --- Stage 2 (<= 1.8s deadline, concurrency 4, max 6 URLs) ---
  const stage2Queue = selectStage2Candidates(dedupedCandidates, detectedCategory, desiredSize);
  const stage2DeadlineAt = Date.now() + STAGE2_DEADLINE_MS;

  if (stage2Queue.length > 0) {
    await withDeadline(
      runPool(stage2Queue, STAGE2_CONCURRENCY, async (candidate) => {
        const remainingMs = stage2DeadlineAt - Date.now();
        if (remainingMs <= 150) return;

        const pageKey = `page:${candidate.canonicalUrl}`;
        let pageData = null;

        if (!forceRefresh) {
          const cachedPage = _cache.get(pageKey);
          if (cachedPage && cachedPage.value) {
            pageData = cachedPage.value;
          }
        }

        if (!pageData) {
          const res = await _storeFetch(candidate.storeId, candidate.url, {
            timeoutMs: Math.min(3000, remainingMs),
          });
          if (!res || !res.ok || !res.text) {
            return;
          }
          const finalParsed = isSafePublicUrl(res.finalUrl || candidate.url) || new URL(candidate.url);
          const storeCfg = {
            ...candidate.resolvedStore,
            scraperConfig: candidate.resolvedStore?.ingestion?.scraperConfig || candidate.resolvedStore?.scraperConfig || null,
          };
          const meta = extractMetadataFromHtml(res.text, finalParsed);
          const extractedPrice = extractPriceFromHtml(res.text, finalParsed, storeCfg);
          const stock = extractStockAndSizesFromHtml(
            res.text,
            finalParsed.toString(),
            detectedCategory,
            desiredSize,
            storeCfg
          );
          pageData = {
            meta,
            price: extractedPrice || meta?.price || null,
            stock,
            cachedAt: Date.now(),
          };
          _cache.set(pageKey, pageData, { freshMs: 3 * 60_000, staleMs: 15 * 60_000 });
        }

        if (pageData.price && pageData.price > 0 && (
          !candidate.price || candidate.priceSource === 'tier3_serper' || candidate.priceSource === 'tier3_bing'
        )) {
          candidate.price = Number(pageData.price);
          candidate.priceSource = 'tier2_live';
          candidate.needsPriceEnrichment = false;
        }
        if (pageData.meta) {
          candidate.gtin = candidate.gtin || pageData.meta.gtin || null;
          candidate.mpn = candidate.mpn || pageData.meta.mpn || null;
          candidate.marketplace = mergeMarketplace(candidate.marketplace, {
            sellerType: pageData.meta.sellerType,
            sellerName: pageData.meta.sellerName,
            isGeniusEligible: pageData.meta.isGeniusEligible,
          });
        }
        if (pageData.stock) {
          candidate.stock = isSized && desiredSize && pageData.stock.availableSizes?.length > 0
            ? evaluateStockFromSizes(pageData.stock.availableSizes, desiredSize, pageData.stock)
            : pageData.stock;
        }
      }),
      STAGE2_DEADLINE_MS,
      undefined
    );
  }

  // --- Finalize Offers, Price History & Cost Math ---
  const validOffers = [];
  for (const c of dedupedCandidates) {
    if (!(typeof c.price === 'number' && c.price > 0)) continue;

    const clusterKey = buildClusterKey({
      title: c.title,
      brand: c.attributes?.brand || c.resolvedStore?.name || '',
      gtin: c.gtin,
      mpn: c.mpn,
      attributes: c.attributes,
    });

    const priceHistory = _cache.recordPriceObservation({
      storeProductKey: c.storeProductKey,
      storeId: c.storeId,
      title: c.title,
      price: c.price,
      url: c.url,
    });

    const shippingProfile = buildShippingProfile(c.resolvedStore);
    const paymentProfile = buildPaymentProfile(c.resolvedStore);
    validOffers.push({
      offerId: c.storeProductKey,
      storeProductKey: c.storeProductKey,
      clusterKey,
      storeId: c.storeId,
      storeName: c.storeName,
      domain: c.domain,
      businessModel: c.resolvedStore?.businessModel || '1p',
      productTitle: c.title,
      url: c.url,
      rawPrice: c.price,
      price: c.price,
      priceSource: c.priceSource,
      verifiedLive: c.stock.verificationState === 'verified_in_stock',
      liveVerifyCapable: c.resolvedStore?.ingestion?.liveVerifyCapable !== false,
      deliveryDays: c.resolvedStore?.shipping?.deliveryDays
        ? `${c.resolvedStore.shipping.deliveryDays.min}-${c.resolvedStore.shipping.deliveryDays.max} zile`
        : '2-4 zile',
      freeThreshold: shippingProfile.channels?.courier?.freeThreshold ?? null,
      shippingProfile,
      paymentProfile,
      returns: c.resolvedStore?.returns || null,
      marketplace: c.marketplace,
      stock: c.stock,
      variantBucket: c.variantBucket,
      score: c.score,
      unitPriceLabel: c.unitPriceLabel,
      attributes: c.attributes,
      gtin: c.gtin,
      mpn: c.mpn,
      priceHistory,
      sources: c.sources,
    });
  }

  const costOptions = buildCostOptions(params);
  const ranked = rankOffers(validOffers, costOptions);

  // Source offer comparison
  let sourceComparison = null;
  const rawSourceOffer = params.sourceOffer || (
    params.sourcePrice > 0
      ? { url: params.sourceUrl || '', price: Number(params.sourcePrice), title: rawQuery }
      : null
  );
  if (rawSourceOffer && Number(rawSourceOffer.price) > 0) {
    const srcStore = _resolveStore(rawSourceOffer.storeId, rawSourceOffer.url || '');
    const hydratedSource = {
      ...rawSourceOffer,
      storeId: srcStore.id,
      storeName: srcStore.name,
      businessModel: rawSourceOffer.businessModel || srcStore.businessModel || '1p',
      price: Number(rawSourceOffer.price),
      rawPrice: Number(rawSourceOffer.price),
      shippingProfile: rawSourceOffer.shippingProfile || buildShippingProfile(srcStore),
      paymentProfile: rawSourceOffer.paymentProfile || buildPaymentProfile(srcStore),
      marketplace: rawSourceOffer.marketplace || { sellerType: srcStore.businessModel === '1p' ? '1p' : 'unknown' },
    };
    sourceComparison = computeSourceComparison(hydratedSource, ranked.bestDeal, costOptions);
  }

  // Manual fallback stores (strict category match, NO 'general' bleed)
  const allStores = _loadStores();
  const matchedStoreIds = new Set(validOffers.map((o) => o.storeId));
  const manualStores = allStores
    .filter((store) => {
      if (matchedStoreIds.has(store.id)) return false;
      if (detectedCategory === 'general') return true;
      return Array.isArray(store.categories) && store.categories.includes(detectedCategory);
    })
    .map((store) => {
      const channels = store.shipping?.channels || {};
      const deliveryChannel = costOptions.deliveryType === 'courier'
        ? (channels.courier || channels.easybox)
        : (channels.easybox || channels.fanbox || channels.courier);
      const rambursAllowed = store.payment?.ramburs?.allowed !== false;
      const rambursFee = costOptions.paymentMethod === 'ramburs' && rambursAllowed
        ? (store.payment?.ramburs?.fee || 0)
        : 0;
      const health = circuitBreaker.getStoreHealth(store.id);
      const template = store.ingestion?.searchUrlTemplate || `https://${store.domains?.[0] || store.domain}/`;

      return {
        storeId: store.id,
        storeName: store.name,
        domain: store.domains?.[0] || store.domain,
        businessModel: store.businessModel,
        bulkyPolicy: store.shipping?.bulkyPolicy || 'standard',
        deliveryDays: store.shipping?.deliveryDays
          ? `${store.shipping.deliveryDays.min}-${store.shipping.deliveryDays.max} zile`
          : '2-4 zile',
        freeThreshold: deliveryChannel?.freeThreshold ?? null,
        baseShipping: deliveryChannel?.fee ?? null,
        rambursFee,
        rambursNonRefundable: Boolean(store.payment?.ramburs?.nonRefundableOnReturn),
        liveVerifyCapable: store.ingestion?.liveVerifyCapable !== false,
        healthState: health?.state || 'CLOSED',
        url: template.replace('{query}', encodeURIComponent(cleanQuery)),
      };
    });

  const uniqueStoresChecked = new Set(validOffers.map((o) => o.storeId)).size;

  const rawCacheStatus = [
    adapterRes?.cacheStatus,
    serperRes?.cacheStatus,
    bingRes?.cacheStatus,
  ].find((status) => status === 'hit' || status === 'stale') || 'miss';
  const normalizedCacheStatus = String(rawCacheStatus).toLowerCase();

  return {
    query: rawQuery,
    cleanQuery,
    detectedCategory,
    desiredSize,
    totalStoresChecked: uniqueStoresChecked,
    totalOffersFound: validOffers.length,
    inStockCount: ranked.inStockCount,
    bestDealStoreId: ranked.bestDeal ? ranked.bestDeal.storeId : null,
    bestDealUrl: ranked.bestDeal ? ranked.bestDeal.url : null,
    maxSavings: ranked.maxSavings,
    offers: ranked.exactOffers,
    otherVariantOffers: ranked.otherVariantOffers,
    manualStores,
    storeHealth: buildStoreHealthList(allStores),
    cacheStatus: normalizedCacheStatus === 'hit' || normalizedCacheStatus === 'stale' ? normalizedCacheStatus : 'miss',
    cachedAt: adapterRes?.cachedAt || serperRes?.cachedAt || bingRes?.cachedAt || Date.now(),
    sourceComparison,
    serperInfo: serperRes?.info || { used: false, shoppingCount: 0, webCount: 0, error: null },
    bingInfo: bingRes?.info || { used: true, offerCount: 0, error: null },
  };
}

async function checkStockBatch(params = {}, deps = {}) {
  const _cache = deps.cache || cache;
  const _storeFetch = deps.storeFetch || storeFetch;
  const _resolveStore = deps.resolveStore || resolveStore;

  const rawUrls = Array.isArray(params.urls) ? params.urls : [];
  const category = params.category && params.category !== 'auto' ? params.category : 'shoes';
  const desiredSize = String(params.desiredSize || params.size || '').trim().toUpperCase();

  const validUrls = [];
  for (const raw of rawUrls) {
    const parsed = isSafePublicUrl(raw);
    if (parsed) {
      validUrls.push(raw);
      if (validUrls.length >= CHECK_STOCK_MAX_URLS) break;
    }
  }

  const deadlineAt = Date.now() + CHECK_STOCK_DEADLINE_MS;
  const results = await withDeadline(
    runPool(validUrls, STAGE2_CONCURRENCY, async (rawUrl) => {
      const canonUrl = canonicalizeUrl(rawUrl);
      const store = _resolveStore(null, canonUrl);
      const pageKey = `page:${canonUrl}`;

      const cached = _cache.get(pageKey);
      if (cached?.value?.stock?.availableSizes?.length > 0) {
        return {
          url: rawUrl,
          stock: evaluateStockFromSizes(cached.value.stock.availableSizes, desiredSize, cached.value.stock),
        };
      }

      // Attempt every store once — the circuit breaker is the real guard
      // against repeatedly hammering bot-blocked targets.
      if (!circuitBreaker.canRequest(store.id)) {
        return {
          url: rawUrl,
          stock: {
            requiresSize: SIZED_CATEGORIES.includes(category),
            verificationState: 'unverified_unknown',
            status: 'unverified',
            label: desiredSize ? `Verifică mărimea ${desiredSize} pe site` : 'Stoc neverificat',
            availableSizes: [],
            hasDesiredSize: null,
            isVerified: false,
          },
        };
      }

      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 150) {
        return {
          url: rawUrl,
          stock: {
            requiresSize: SIZED_CATEGORIES.includes(category),
            verificationState: 'unverified_unknown',
            status: 'unverified',
            label: 'Timeout verificare stoc',
            availableSizes: [],
            hasDesiredSize: null,
            isVerified: false,
          },
        };
      }

      const res = await _storeFetch(store.id, rawUrl, { timeoutMs: Math.min(2500, remainingMs) });
      const debugFetch = params.debug ? {
        status: res?.status, error: res?.error || null, len: (res?.text || '').length,
        transport: res?.transport || null, botBlocked: Boolean(res?.botBlocked),
      } : undefined;
      if (!res || !res.ok || !res.text) {
        return {
          url: rawUrl,
          debugFetch,
          stock: {
            requiresSize: SIZED_CATEGORIES.includes(category),
            verificationState: 'unverified_unknown',
            status: 'unverified',
            label: desiredSize ? `Verifică mărimea ${desiredSize} pe site` : 'Stoc neverificat',
            availableSizes: [],
            hasDesiredSize: null,
            isVerified: false,
          },
        };
      }

      const finalParsed = isSafePublicUrl(res.finalUrl || rawUrl) || new URL(rawUrl);
      const storeCfg = {
        ...store,
        scraperConfig: store?.ingestion?.scraperConfig || store?.scraperConfig || null,
      };
      const stock = extractStockAndSizesFromHtml(res.text, finalParsed.toString(), category, desiredSize, storeCfg);
      const existingVal = cached?.value || {};
      _cache.set(pageKey, { ...existingVal, stock, cachedAt: Date.now() }, { freshMs: 3 * 60_000, staleMs: 15 * 60_000 });
      return { url: rawUrl, stock, debugFetch };
    }),
    CHECK_STOCK_DEADLINE_MS,
    validUrls.map((url) => ({
      url,
      stock: {
        requiresSize: SIZED_CATEGORIES.includes(category),
        verificationState: 'unverified_unknown',
        status: 'unverified',
        label: 'Timeout verificare stoc',
        availableSizes: [],
        hasDesiredSize: null,
        isVerified: false,
      },
    }))
  );

  return { results };
}

async function analyzeProductUrl(rawUrl, deps = {}) {
  const parsedUrl = isSafePublicUrl(rawUrl);
  if (!parsedUrl) {
    const err = new Error('Link invalid. Te rog introdu un URL valid care începe cu https:// sau http://.');
    err.statusCode = 400;
    throw err;
  }

  const _cache = deps.cache || cache;
  const _storeFetch = deps.storeFetch || storeFetch;
  const _resolveStore = deps.resolveStore || resolveStore;

  const canonUrl = canonicalizeUrl(parsedUrl.toString());
  const store = _resolveStore(null, canonUrl);
  const analyzeKey = `analyze:${canonUrl}`;

  const fetchAndParse = async () => {
    let metadata = {
      title: extractSlugFromUrl(parsedUrl),
      image: '',
      price: null,
      currency: 'RON',
      brand: '',
      gtin: null,
      mpn: null,
      sellerType: store.businessModel === '1p' ? '1p' : 'unknown',
      sellerName: null,
      isGeniusEligible: null,
      scrapedLive: false,
      domain: parsedUrl.hostname.replace(/^www\./, ''),
    };

    if (circuitBreaker.canRequest(store.id)) {
      const res = await _storeFetch(store.id, parsedUrl.toString(), { timeoutMs: 4500 });
      if (res && res.ok && res.text) {
        const finalParsed = isSafePublicUrl(res.finalUrl || canonUrl) || parsedUrl;
        const storeCfg = {
          ...store,
          scraperConfig: store?.ingestion?.scraperConfig || store?.scraperConfig || null,
        };
        const extracted = extractMetadataFromHtml(res.text, finalParsed);
        const extractedPrice = extracted?.price || extractPriceFromHtml(res.text, finalParsed, storeCfg);
        metadata = {
          ...metadata,
          ...extracted,
          price: extractedPrice || extracted?.price || null,
        };
      }
    }

    const safeImgParsed = metadata.image ? isSafePublicUrl(metadata.image) : null;
    const safeImage = safeImgParsed ? safeImgParsed.toString() : '';

    const detectedCategory = detectCategory(`${metadata.title} ${store.vertical || ''} ${parsedUrl.hostname}`);
    const distilled = distillQuery(metadata.title, metadata.brand);
    const distilledQuery = distilled && distilled.length >= 2 ? distilled : metadata.title;
    const extractedAttributes = extractAttributes(metadata.title, detectedCategory);

    const sourceOffer = {
      url: canonUrl,
      storeId: store.id,
      storeName: store.name,
      domain: metadata.domain,
      businessModel: store.businessModel || '1p',
      title: metadata.title,
      price: metadata.price,
      rawPrice: metadata.price,
      shippingProfile: buildShippingProfile(store),
      paymentProfile: buildPaymentProfile(store),
      marketplace: {
        sellerType: metadata.sellerType || (store.businessModel === '1p' ? '1p' : 'unknown'),
        sellerName: metadata.sellerName || null,
        isGeniusEligible: typeof metadata.isGeniusEligible === 'boolean' ? metadata.isGeniusEligible : null,
      },
    };

    return {
      title: metadata.title,
      distilledQuery,
      image: safeImage,
      price: metadata.price,
      currency: metadata.currency || 'RON',
      brand: metadata.brand || '',
      gtin: metadata.gtin || null,
      mpn: metadata.mpn || null,
      storeId: store.id,
      domain: metadata.domain,
      detectedCategory,
      extractedAttributes,
      scrapedLive: Boolean(metadata.scrapedLive),
      sourceOffer,
    };
  };

  const cachedRes = await _cache.getOrFetch(analyzeKey, fetchAndParse, {
    freshMs: 10 * 60_000,
    staleMs: 30 * 60_000,
    negativeMs: 60_000,
  });
  return cachedRes && cachedRes.value !== undefined ? cachedRes.value : cachedRes;
}

module.exports = {
  runSearchPipeline,
  checkStockBatch,
  analyzeProductUrl,
  buildShippingProfile,
  buildPaymentProfile,
};
