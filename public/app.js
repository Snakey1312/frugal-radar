(() => {
  'use strict';

  const SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
  const CLOTHES_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const GEMINI_KEY_STORAGE = 'frugalradar_gemini_key';
  const SERPER_KEY_STORAGE = 'frugalradar_serper_key';
  const REMEMBER_KEYS_STORAGE = 'frugalradar_remember_keys';

  const DEFAULT_MEMBERSHIP_PROGRAMS = {
    emagGenius: {
      label: 'eMAG Genius',
      tiers: [
        { id: 'none', label: 'Fără', hint: 'Transport standard' },
        { id: 'light', label: 'Genius Light (locker >=30 lei)', hint: 'Easybox gratuit de la 30 lei (produse Genius)' },
        { id: 'premium', label: 'Genius Premium (curier >=100 lei)', hint: 'Easybox >=30 lei și curier >=100 lei (produse Genius)' },
      ],
    },
    farmaciaTeiElite: { label: 'Tei ELITE', hint: 'Beneficii livrare Farmacia Tei / Bebe Tei' },
    sephoraGold: { label: 'Sephora Gold', hint: 'Livrare gratuită Sephora' },
  };

  const CAT_LABELS = {
    shoes: 'Încălțăminte',
    clothes: 'Haine',
    electronics: 'Electronice / IT',
    supplements: 'Suplimente / Sport',
    pharmacy_beauty: 'Farmacie & Beauty',
    diy_home: 'Casă & Bricolaj',
    books: 'Cărți',
    general: 'General',
  };

  const state = {
    lastQuery: '',
    lastSearchCategory: 'auto',
    detectedCategory: 'general',
    desiredSize: '',
    sourceOffer: null,
    rawOffers: [],
    lastResponseMeta: null,
    storesById: new Map(),
    storesList: [],
    membershipPrograms: DEFAULT_MEMBERSHIP_PROGRAMS,
    memberships: {
      emagGenius: 'none',
      farmaciaTeiElite: false,
      sephoraGold: false,
    },
    currentPhotoObjectUrl: null,
    activeStockCheckController: null,
  };

  // Elements
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  const storesCountBadge = document.getElementById('stores-count-badge');
  const heroStoreCount = document.getElementById('hero-store-count');

  const formName = document.getElementById('form-name');
  const formLink = document.getElementById('form-link');
  const formLinkConfirm = document.getElementById('form-link-confirm');
  const formPhoto = document.getElementById('form-photo');

  const nameInput = document.getElementById('product-name-input');
  const urlInput = document.getElementById('product-url-input');
  const urlPreviewBox = document.getElementById('url-preview-box');
  const linkQueryInput = document.getElementById('link-query-input');

  const photoDropzone = document.getElementById('photo-dropzone');
  const photoFileInput = document.getElementById('photo-file-input');
  const dropzoneEmpty = document.getElementById('dropzone-empty');
  const dropzonePreview = document.getElementById('dropzone-preview');
  const photoPreviewImg = document.getElementById('photo-preview-img');
  const photoFileName = document.getElementById('photo-file-name');
  const photoAiStatus = document.getElementById('photo-ai-status');
  const clearPhotoBtn = document.getElementById('clear-photo-btn');
  const photoQueryInput = document.getElementById('photo-query-input');

  const categorySelect = document.getElementById('category-select');
  const sizeSelect = document.getElementById('size-select');
  const sizeOptionGroup = document.getElementById('size-option-group');
  const deliverySelect = document.getElementById('delivery-select');
  const paymentSelect = document.getElementById('payment-select');
  const voucherInput = document.getElementById('voucher-input');
  const voucherStoreSelect = document.getElementById('voucher-store-select');

  const membershipDropdown = document.getElementById('membership-dropdown');
  const membershipsBtn = document.getElementById('memberships-btn');
  const membershipsPopover = document.getElementById('memberships-popover');

  const resultsSection = document.getElementById('results-section');
  const sourceComparisonBanner = document.getElementById('source-comparison-banner');
  const winnerCard = document.getElementById('winner-card');
  const resultsHeading = document.getElementById('results-heading');
  const resultsSubhead = document.getElementById('results-subhead');
  const cacheBar = document.getElementById('cache-bar');
  const cacheFreshnessText = document.getElementById('cache-freshness-text');
  const refreshLiveBtn = document.getElementById('refresh-live-btn');
  const onlyInStockToggle = document.getElementById('only-in-stock-toggle');
  const onlyInStockWrap = document.getElementById('only-in-stock-wrap');
  const resultsTbody = document.getElementById('results-tbody');
  const otherVariantsDetails = document.getElementById('other-variants-details');
  const otherVariantsSummary = document.getElementById('other-variants-summary');
  const otherVariantsTbody = document.getElementById('other-variants-tbody');
  const manualStoresBox = document.getElementById('manual-stores-box');
  const storeHealthStrip = document.getElementById('store-health-strip');

  const settingsDialog = document.getElementById('settings-dialog');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const serperKeyInput = document.getElementById('serper-key-input');
  const geminiKeyInput = document.getElementById('gemini-key-input');
  const rememberKeysCheck = document.getElementById('remember-keys-check');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const clearKeyBtn = document.getElementById('clear-key-btn');

  // --- Security & Formatting Helpers ---
  function safeHttpUrl(u) {
    if (!u || typeof u !== 'string') return null;
    try {
      const parsed = new URL(u.trim());
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
      return null;
    } catch {
      return null;
    }
  }

  function formatLei(amount) {
    if (amount === null || amount === undefined || Number.isNaN(Number(amount))) {
      return '—';
    }
    return `${Number(amount).toLocaleString('ro-RO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} lei`;
  }

  function formatCompactLei(amount) {
    if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
    const num = Number(amount);
    const hasFraction = Math.abs(num - Math.round(num)) >= 0.01;
    return `${num.toLocaleString('ro-RO', {
      minimumFractionDigits: hasFraction ? 2 : 0,
      maximumFractionDigits: hasFraction ? 2 : 0,
    })} lei`;
  }

  function getSizedCategories() {
    return Array.isArray(window.FrugalCost?.SIZED_CATEGORIES)
      ? window.FrugalCost.SIZED_CATEGORIES
      : ['shoes', 'clothes'];
  }

  function isSizedCategory(cat) {
    return getSizedCategories().includes(cat);
  }

  function createSafeLink(url, text, className = 'btn-link') {
    const safeHref = safeHttpUrl(url);
    if (!safeHref) {
      const span = document.createElement('span');
      span.className = 'muted';
      span.textContent = 'Link indisponibil';
      return span;
    }
    const a = document.createElement('a');
    a.href = safeHref;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = className;
    a.textContent = text;
    return a;
  }

  // --- BYOK Key Storage (sessionStorage default, opt-in localStorage) ---
  function getStoredKey(storageKey) {
    return sessionStorage.getItem(storageKey) || localStorage.getItem(storageKey) || '';
  }

  function isRememberKeysEnabled() {
    return localStorage.getItem(REMEMBER_KEYS_STORAGE) === '1'
      || Boolean(localStorage.getItem(SERPER_KEY_STORAGE) || localStorage.getItem(GEMINI_KEY_STORAGE));
  }

  function saveStoredKeys(serperVal, geminiVal, remember) {
    sessionStorage.removeItem(SERPER_KEY_STORAGE);
    sessionStorage.removeItem(GEMINI_KEY_STORAGE);
    localStorage.removeItem(SERPER_KEY_STORAGE);
    localStorage.removeItem(GEMINI_KEY_STORAGE);

    const targetStore = remember ? localStorage : sessionStorage;
    if (remember) {
      localStorage.setItem(REMEMBER_KEYS_STORAGE, '1');
    } else {
      localStorage.removeItem(REMEMBER_KEYS_STORAGE);
    }

    if (serperVal) targetStore.setItem(SERPER_KEY_STORAGE, serperVal);
    if (geminiVal) targetStore.setItem(GEMINI_KEY_STORAGE, geminiVal);
  }

  function clearStoredKeys() {
    sessionStorage.removeItem(SERPER_KEY_STORAGE);
    sessionStorage.removeItem(GEMINI_KEY_STORAGE);
    localStorage.removeItem(SERPER_KEY_STORAGE);
    localStorage.removeItem(GEMINI_KEY_STORAGE);
    localStorage.removeItem(REMEMBER_KEYS_STORAGE);
  }

  // --- Accessible Tabs ---
  function selectTab(targetTab, moveFocus = false) {
    tabs.forEach((tab, idx) => {
      const selected = tab === targetTab;
      tab.setAttribute('aria-selected', String(selected));
      tab.setAttribute('tabindex', selected ? '0' : '-1');
      const panel = panels[idx];
      if (selected) {
        panel.removeAttribute('hidden');
        panel.setAttribute('tabindex', '0');
      } else {
        panel.setAttribute('hidden', 'until-found');
        panel.removeAttribute('tabindex');
      }
    });
    if (moveFocus) targetTab.focus();
  }

  tabs.forEach((tab, idx) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', (e) => {
      let nextIdx = null;
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (e.key === 'Home') nextIdx = 0;
      else if (e.key === 'End') nextIdx = tabs.length - 1;
      if (nextIdx !== null) {
        e.preventDefault();
        selectTab(tabs[nextIdx], true);
      }
    });
  });

  panels.forEach((panel, idx) => {
    panel.addEventListener('beforematch', () => selectTab(tabs[idx]));
  });

  // --- Validation & ARIA sync ---
  const announcer = document.createElement('div');
  announcer.setAttribute('aria-live', 'polite');
  announcer.className = 'visually-hidden';
  document.body.append(announcer);

  function syncAriaValidation(el) {
    if (!el.matches?.('input, select, textarea')) return;
    const supportsUserInvalid = CSS.supports('selector(:user-invalid)');
    const invalid = supportsUserInvalid
      ? el.matches(':user-invalid')
      : el.classList.contains('user-invalid-fallback');
    el.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    const errorId = el.dataset.error;
    if (errorId) {
      const ids = (el.getAttribute('aria-describedby') || '')
        .split(/\s+/)
        .filter((id) => id && id !== errorId);
      if (invalid) ids.push(errorId);
      if (ids.length) el.setAttribute('aria-describedby', ids.join(' '));
      else el.removeAttribute('aria-describedby');
    }
  }

  document.querySelectorAll('input, select').forEach((el) => {
    el.setAttribute('aria-invalid', 'false');
    el.addEventListener('blur', () => {
      if (!CSS.supports('selector(:user-invalid)')) {
        el.classList.toggle('user-invalid-fallback', !el.validity.valid);
      }
      syncAriaValidation(el);
    });
    el.addEventListener('input', () => {
      if (!CSS.supports('selector(:user-invalid)') && el.classList.contains('user-invalid-fallback')) {
        el.classList.toggle('user-invalid-fallback', !el.validity.valid);
      }
      syncAriaValidation(el);
    });
  });

  // --- Boot /api/stores + Memberships Popover + Store-Scoped Voucher ---
  function countActiveMemberships() {
    let n = 0;
    if (state.memberships.emagGenius && state.memberships.emagGenius !== 'none') n += 1;
    if (state.memberships.farmaciaTeiElite) n += 1;
    if (state.memberships.sephoraGold) n += 1;
    return n;
  }

  function updateMembershipsButtonLabel() {
    const count = countActiveMemberships();
    const expanded = membershipsBtn.getAttribute('aria-expanded') === 'true';
    membershipsBtn.textContent = `Abonamente (${count}) ${expanded ? '▴' : '▾'}`;
  }

  function renderMembershipsPopover() {
    membershipsPopover.replaceChildren();

    const geniusSection = document.createElement('div');
    geniusSection.className = 'membership-section';
    const geniusTitle = document.createElement('span');
    geniusTitle.className = 'membership-section-title';
    geniusTitle.textContent = 'eMAG / Fashion Days Genius';
    geniusSection.append(geniusTitle);

    const geniusTiers = DEFAULT_MEMBERSHIP_PROGRAMS.emagGenius.tiers;
    geniusTiers.forEach((tier) => {
      const label = document.createElement('label');
      label.className = 'membership-option';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'emag-genius';
      radio.value = tier.id;
      radio.checked = state.memberships.emagGenius === tier.id;
      radio.addEventListener('change', () => {
        if (radio.checked) {
          state.memberships.emagGenius = tier.id;
          updateMembershipsButtonLabel();
          recalculateOffersClientSide();
        }
      });

      const textWrap = document.createElement('span');
      textWrap.textContent = tier.label;
      const hint = document.createElement('small');
      hint.textContent = tier.hint;
      textWrap.append(hint);

      label.append(radio, textWrap);
      geniusSection.append(label);
    });

    const otherSection = document.createElement('div');
    otherSection.className = 'membership-section';
    const otherTitle = document.createElement('span');
    otherTitle.className = 'membership-section-title';
    otherTitle.textContent = 'Alte abonamente';
    otherSection.append(otherTitle);

    const otherPrograms = [
      {
        key: 'farmaciaTeiElite',
        label: state.membershipPrograms?.farmaciaTeiElite?.label || DEFAULT_MEMBERSHIP_PROGRAMS.farmaciaTeiElite.label,
        hint: state.membershipPrograms?.farmaciaTeiElite?.hint || DEFAULT_MEMBERSHIP_PROGRAMS.farmaciaTeiElite.hint,
      },
      {
        key: 'sephoraGold',
        label: state.membershipPrograms?.sephoraGold?.label || DEFAULT_MEMBERSHIP_PROGRAMS.sephoraGold.label,
        hint: state.membershipPrograms?.sephoraGold?.hint || DEFAULT_MEMBERSHIP_PROGRAMS.sephoraGold.hint,
      },
    ];

    otherPrograms.forEach((prog) => {
      const label = document.createElement('label');
      label.className = 'membership-option';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Boolean(state.memberships[prog.key]);
      cb.addEventListener('change', () => {
        state.memberships[prog.key] = cb.checked;
        updateMembershipsButtonLabel();
        recalculateOffersClientSide();
      });

      const textWrap = document.createElement('span');
      textWrap.textContent = prog.label;
      if (prog.hint) {
        const hint = document.createElement('small');
        hint.textContent = prog.hint;
        textWrap.append(hint);
      }

      label.append(cb, textWrap);
      otherSection.append(label);
    });

    membershipsPopover.append(geniusSection, otherSection);
    updateMembershipsButtonLabel();
  }

  function setMembershipsOpen(open) {
    membershipsPopover.hidden = !open;
    membershipsBtn.setAttribute('aria-expanded', String(open));
    updateMembershipsButtonLabel();
  }

  membershipsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = membershipsBtn.getAttribute('aria-expanded') === 'true';
    setMembershipsOpen(!isOpen);
  });

  document.addEventListener('click', (e) => {
    if (!membershipDropdown.contains(e.target)) {
      setMembershipsOpen(false);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && membershipsBtn.getAttribute('aria-expanded') === 'true') {
      setMembershipsOpen(false);
      membershipsBtn.focus();
    }
  });

  renderMembershipsPopover();

  function populateVoucherStores(stores) {
    const prevValue = voucherStoreSelect.value || 'all';
    voucherStoreSelect.replaceChildren();

    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'Toate magazinele';
    voucherStoreSelect.append(allOpt);

    const sorted = [...stores].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ro'));
    sorted.forEach((store) => {
      const opt = document.createElement('option');
      opt.value = store.id;
      opt.textContent = store.name;
      voucherStoreSelect.append(opt);
    });

    if ([...voucherStoreSelect.options].some((o) => o.value === prevValue)) {
      voucherStoreSelect.value = prevValue;
    }
  }

  async function bootStores() {
    try {
      const resp = await fetch('/api/stores');
      if (!resp.ok) return;
      const data = await resp.json();
      const stores = Array.isArray(data.stores) ? data.stores : [];
      const total = typeof data.total === 'number' ? data.total : stores.length;

      storesCountBadge.textContent = `${total} magazine RO`;
      if (heroStoreCount) heroStoreCount.textContent = String(total);
      state.storesList = stores;
      state.storesById = new Map(stores.map((s) => [s.id, s]));

      if (data.membershipPrograms && typeof data.membershipPrograms === 'object') {
        state.membershipPrograms = { ...DEFAULT_MEMBERSHIP_PROGRAMS, ...data.membershipPrograms };
        renderMembershipsPopover();
      }
      populateVoucherStores(stores);
    } catch {
      storesCountBadge.textContent = 'Magazine RO';
    }
  }

  bootStores();

  // --- Size Selector ---
  function updateSizeSelector(category, preserveSize = '') {
    const current = preserveSize !== undefined && preserveSize !== null
      ? String(preserveSize)
      : sizeSelect.value;
    sizeSelect.replaceChildren();

    if (category !== 'auto' && !isSizedCategory(category)) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nu necesită mărime';
      sizeSelect.append(opt);
      sizeSelect.value = '';
      sizeSelect.disabled = true;
      sizeOptionGroup.style.opacity = '0.65';
      return;
    }

    sizeSelect.disabled = false;
    sizeOptionGroup.style.opacity = '1';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Toate mărimile';
    sizeSelect.append(defaultOpt);

    const list = category === 'shoes'
      ? SHOE_SIZES
      : category === 'clothes'
        ? CLOTHES_SIZES
        : [...SHOE_SIZES, ...CLOTHES_SIZES];

    list.forEach((sz) => {
      const opt = document.createElement('option');
      opt.value = sz;
      opt.textContent = category === 'shoes' ? `EU ${sz}` : sz;
      if (sz === current) opt.selected = true;
      sizeSelect.append(opt);
    });
  }

  updateSizeSelector('auto', '');

  function getCostOptions() {
    const voucherPercent = Math.max(0, Math.min(50, Number(voucherInput.value) || 0));
    return {
      deliveryType: deliverySelect.value,
      paymentMethod: paymentSelect.value,
      desiredSize: sizeSelect.value,
      voucherPercent,
      voucherStoreId: voucherStoreSelect.value || 'all',
      memberships: {
        emagGenius: state.memberships.emagGenius,
        farmaciaTeiElite: state.memberships.farmaciaTeiElite,
        sephoraGold: state.memberships.sephoraGold,
      },
    };
  }

  // --- Instant 0ms Client-Side Cost Ranking ---
  function rankOffersClientSide(rawOffers, options) {
    if (window.FrugalCost && typeof window.FrugalCost.rankOffers === 'function') {
      return window.FrugalCost.rankOffers(rawOffers, options);
    }
    const exactOffers = rawOffers.filter((o) => o.variantBucket !== 'different_variant');
    const otherVariantOffers = rawOffers.filter((o) => o.variantBucket === 'different_variant');
    const inStock = exactOffers.filter((o) => o.stock?.hasDesiredSize !== false);
    const bestDeal = inStock[0] || exactOffers[0] || null;
    const priced = exactOffers.filter((o) => typeof o.totalCost === 'number');
    const highest = priced[priced.length - 1];
    const maxSavings = bestDeal && highest && typeof bestDeal.totalCost === 'number' && priced.length > 1
      ? Number((highest.totalCost - bestDeal.totalCost).toFixed(2))
      : 0;
    return {
      exactOffers,
      otherVariantOffers,
      bestDeal,
      maxSavings,
      inStockCount: inStock.filter((o) => o.stock?.verificationState === 'verified_in_stock').length,
    };
  }

  function recalculateOffersClientSide() {
    if (!state.lastResponseMeta) return;
    const options = getCostOptions();
    const ranked = rankOffersClientSide(state.rawOffers, options);
    let sourceComparison = state.lastResponseMeta.sourceComparison || null;

    if (
      state.sourceOffer &&
      window.FrugalCost &&
      typeof window.FrugalCost.computeSourceComparison === 'function'
    ) {
      sourceComparison = window.FrugalCost.computeSourceComparison(
        state.sourceOffer,
        ranked.bestDeal,
        options
      );
    }

    renderResults({
      ...state.lastResponseMeta,
      desiredSize: sizeSelect.value,
      offers: ranked.exactOffers,
      otherVariantOffers: ranked.otherVariantOffers,
      bestDeal: ranked.bestDeal,
      maxSavings: ranked.maxSavings,
      inStockCount: ranked.inStockCount,
      sourceComparison,
    });
  }

  // --- Targeted Size Check (Client-side availableSizes + POST /api/check-stock only for eligible unverified_unknown) ---
  function normalizeSizeToken(token) {
    return String(token || '').replace(/^eu\s+/i, '').trim().toUpperCase();
  }

  function updateOfferStockForSizeLocally(offer, desiredSize) {
    const stock = offer.stock || {};
    const sizes = Array.isArray(stock.availableSizes) ? stock.availableSizes : [];

    if (!desiredSize) {
      if (stock.verificationState === 'verified_out_of_stock' && sizes.length === 0) {
        return offer;
      }
      if (sizes.length > 0) {
        return {
          ...offer,
          stock: {
            ...stock,
            requiresSize: false,
            verificationState: 'verified_in_stock',
            status: 'in_stock',
            label: 'În stoc',
            hasDesiredSize: true,
            isVerified: true,
          },
        };
      }
      return {
        ...offer,
        stock: {
          ...stock,
          requiresSize: false,
          hasDesiredSize: stock.verificationState === 'verified_in_stock' ? true : null,
        },
      };
    }

    if (sizes.length > 0) {
      const target = normalizeSizeToken(desiredSize);
      const found = sizes.some((s) => normalizeSizeToken(s) === target);
      return {
        ...offer,
        stock: {
          ...stock,
          requiresSize: true,
          verificationState: found ? 'verified_in_stock' : 'verified_out_of_stock',
          status: found ? 'in_stock' : 'out_of_stock',
          label: found ? `Mărimea ${desiredSize} în stoc` : `Mărimea ${desiredSize} indisponibilă`,
          hasDesiredSize: found,
          isVerified: true,
        },
      };
    }

    if (stock.verificationState === 'verified_out_of_stock') {
      return {
        ...offer,
        stock: {
          ...stock,
          requiresSize: true,
          hasDesiredSize: false,
          isVerified: true,
        },
      };
    }

    return {
      ...offer,
      stock: {
        ...stock,
        requiresSize: true,
        verificationState: 'unverified_unknown',
        status: 'unknown',
        label: `Verifică mărimea ${desiredSize}`,
        hasDesiredSize: null,
        isVerified: false,
      },
    };
  }

  function isOfferLiveVerifyCapable() {
    // The server attempts every store once and uses its circuit breaker to
    // stop hammering genuinely blocked ones, so don't pre-skip any offer here.
    return true;
  }

  async function handleSizeChange() {
    if (!state.lastResponseMeta || state.rawOffers.length === 0) return;

    const newSize = sizeSelect.value;
    state.desiredSize = newSize;

    // 1. Instant client-side update for offers with availableSizes
    state.rawOffers = state.rawOffers.map((o) => updateOfferStockForSizeLocally(o, newSize));
    recalculateOffersClientSide();

    if (!newSize) return;

    const effectiveCategory = categorySelect.value !== 'auto'
      ? categorySelect.value
      : state.detectedCategory;

    if (!isSizedCategory(effectiveCategory)) return;

    // 2. Targeted live check for every still-unverified offer (server handles blocks)
    const urlsToVerify = state.rawOffers
      .filter((o) => o.stock?.verificationState === 'unverified_unknown' && isOfferLiveVerifyCapable(o))
      .map((o) => o.url)
      .filter((u, idx, arr) => Boolean(u) && arr.indexOf(u) === idx);

    if (urlsToVerify.length === 0) return;

    if (state.activeStockCheckController) {
      state.activeStockCheckController.abort();
    }
    const controller = new AbortController();
    state.activeStockCheckController = controller;

    announcer.textContent = `Verific stocul live pentru mărimea ${newSize} la ${urlsToVerify.length} oferte...`;

    try {
      const resp = await fetch('/api/check-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          urls: urlsToVerify,
          category: effectiveCategory,
          desiredSize: newSize,
        }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      const results = Array.isArray(data.results) ? data.results : [];
      const stockByUrl = new Map(results.map((r) => [r.url, r.stock]));

      state.rawOffers = state.rawOffers.map((offer) => {
        const updatedStock = stockByUrl.get(offer.url);
        if (!updatedStock) return offer;
        return { ...offer, stock: updatedStock };
      });
      recalculateOffersClientSide();
    } catch (err) {
      if (err.name !== 'AbortError') {
        // Keep unverified_unknown state transparently
      }
    }
  }

  // Option Listeners -> 0ms client recalculation (ZERO /api/search calls!)
  categorySelect.addEventListener('change', () => {
    const newCat = categorySelect.value;
    updateSizeSelector(newCat, sizeSelect.value);
    if (state.lastQuery) {
      runSearch(state.lastQuery, { sourceOffer: state.sourceOffer });
    }
  });

  sizeSelect.addEventListener('change', () => {
    handleSizeChange();
  });

  [deliverySelect, paymentSelect, voucherInput, voucherStoreSelect].forEach((ctrl) => {
    ctrl.addEventListener('change', () => {
      recalculateOffersClientSide();
    });
  });

  voucherInput.addEventListener('input', () => {
    recalculateOffersClientSide();
  });

  onlyInStockToggle.addEventListener('change', () => {
    recalculateOffersClientSide();
  });

  refreshLiveBtn.addEventListener('click', () => {
    if (state.lastQuery) {
      runSearch(state.lastQuery, { forceRefresh: true, sourceOffer: state.sourceOffer });
    }
  });

  // --- Quick Examples ---
  document.querySelectorAll('.chip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const query = btn.dataset.example;
      const cat = btn.dataset.cat || 'auto';
      const size = btn.dataset.size || '';
      nameInput.value = query;
      categorySelect.value = cat;
      updateSizeSelector(cat, size);
      state.sourceOffer = null;
      runSearch(query, { sourceOffer: null });
    });
  });

  // --- Search API ---
  async function runSearch(query, { forceRefresh = false, sourceOffer = null } = {}) {
    state.lastQuery = query;
    state.lastSearchCategory = categorySelect.value;
    state.sourceOffer = sourceOffer;

    announcer.textContent = `Caut ${query} pe magazinele românești...`;
    resultsSection.hidden = false;
    sourceComparisonBanner.hidden = true;
    winnerCard.replaceChildren();
    const loadingP = document.createElement('p');
    loadingP.className = 'muted';
    loadingP.textContent = forceRefresh
      ? 'Se actualizează ofertele live de pe site-urile din România...'
      : 'Se caută cele mai bune prețuri și stocurile pe site-urile din România...';
    winnerCard.append(loadingP);

    const headers = { 'Content-Type': 'application/json' };
    const serperKey = getStoredKey(SERPER_KEY_STORAGE);
    if (serperKey) {
      headers['X-Serper-Key'] = serperKey;
    }

    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query,
          category: categorySelect.value,
          size: sizeSelect.value,
          forceRefresh,
          sourceOffer,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Eroare la căutare.');
      }

      state.detectedCategory = data.detectedCategory || 'general';
      state.desiredSize = data.desiredSize || '';

      // Combine exact/unverified and otherVariantOffers into rawOffers for 0ms client recalculation
      const baseOffers = Array.isArray(data.offers) ? data.offers : [];
      const variantOffers = Array.isArray(data.otherVariantOffers)
        ? data.otherVariantOffers.map((o) => ({
            ...o,
            variantBucket: o.variantBucket || 'different_variant',
          }))
        : [];
      state.rawOffers = [...baseOffers, ...variantOffers];

      state.lastResponseMeta = {
        query: data.query,
        detectedCategory: data.detectedCategory,
        desiredSize: data.desiredSize,
        totalStoresChecked: data.totalStoresChecked,
        totalOffersFound: data.totalOffersFound ?? baseOffers.length,
        manualStores: data.manualStores || [],
        storeHealth: data.storeHealth || null,
        cacheStatus: data.cacheStatus || null,
        cachedAt: data.cachedAt || null,
        sourceComparison: data.sourceComparison || null,
        serperInfo: data.serperInfo || null,
      };

      // Sync size selector if auto-detected category
      if (categorySelect.value === 'auto' && data.detectedCategory) {
        updateSizeSelector(data.detectedCategory, data.desiredSize || '');
      }

      recalculateOffersClientSide();
      announcer.textContent = `Am găsit ${data.totalOffersFound ?? baseOffers.length} oferte pentru ${data.query}.`;
    } catch (err) {
      winnerCard.replaceChildren();
      const p = document.createElement('p');
      p.className = 'error-msg';
      p.style.display = 'block';
      p.textContent = err.message;
      winnerCard.append(p);
    }
  }

  // --- Rendering Helpers ---
  function formatCacheFreshness(cacheStatus, cachedAt) {
    if (!cacheStatus && !cachedAt) return '';
    if (cacheStatus === 'miss' || cacheStatus === 'bypass') return 'Date live acum';
    let ageTxt = '';
    if (cachedAt) {
      const ts = new Date(cachedAt).getTime();
      if (!Number.isNaN(ts)) {
        const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
        if (diffSec < 60) ageTxt = `acum ${diffSec}s`;
        else ageTxt = `acum ${Math.round(diffSec / 60)} min`;
      }
    }
    if (cacheStatus === 'stale') return `Din cache extins (${ageTxt || 'reîmprospătare'})`;
    if (cacheStatus === 'hit') return `Din cache (${ageTxt || 'recent'})`;
    return ageTxt ? `Actualizat ${ageTxt}` : '';
  }

  function isMarketplace3POffer(offer) {
    const sellerType = offer.marketplace?.sellerType || offer.sellerType;
    const bizModel = offer.shippingProfile?.businessModel || offer.businessModel;
    if (sellerType === '3p' || offer.isMarketplace3P === true || offer.marketplace?.is3p === true) return true;
    if (bizModel === 'marketplace_pure') return true;
    if (bizModel === 'marketplace_hybrid' && offer.marketplace?.is1p === false) return true;
    return false;
  }

  function isUnknownShipping(offer) {
    return offer.shippingState === 'unknown_checkout'
      || offer.shippingFee === null
      || offer.shippingFee === undefined;
  }

  function buildOfferBadges(offer) {
    const badges = [];

    if (isMarketplace3POffer(offer)) {
      const b = document.createElement('span');
      b.className = 'meta-badge badge-3p';
      b.textContent = 'Vânzător 3P — verifică transport';
      badges.push(b);
    }

    const hist = offer.priceHistory;
    if (hist && hist.observations > 1) {
      const refPrice = offer.originalPrice ?? offer.discountedPrice;
      if (typeof hist.minPrice === 'number' && typeof refPrice === 'number' && refPrice <= hist.minPrice) {
        const b = document.createElement('span');
        b.className = 'meta-badge badge-history-min';
        b.textContent = 'Minim istoric';
        badges.push(b);
      }
      if (typeof hist.priceDelta === 'number' && hist.priceDelta < -0.5) {
        const b = document.createElement('span');
        b.className = 'meta-badge badge-history-drop';
        b.textContent = `-${formatCompactLei(Math.abs(hist.priceDelta))}`;
        badges.push(b);
      }
    }

    if (offer.unitPriceLabel) {
      const b = document.createElement('span');
      b.className = 'meta-badge badge-unit';
      b.textContent = offer.unitPriceLabel;
      badges.push(b);
    }

    return badges;
  }

  function renderSourceComparisonBanner(sourceComparison) {
    sourceComparisonBanner.replaceChildren();
    if (!sourceComparison || !state.sourceOffer) {
      sourceComparisonBanner.hidden = true;
      sourceComparisonBanner.classList.remove('is-best-source');
      return;
    }

    sourceComparisonBanner.hidden = false;
    const textSpan = document.createElement('span');
    const sourceName = state.sourceOffer.storeName || state.sourceOffer.domain || 'link-ul sursă';

    if (sourceComparison.isSourceBest) {
      sourceComparisonBanner.classList.add('is-best-source');
      textSpan.textContent = `✅ Link-ul analizat (${sourceName}) are deja cel mai mic cost total: ${formatLei(sourceComparison.sourceTotalCost)}.`;
    } else if (typeof sourceComparison.savingsVsSource === 'number' && sourceComparison.savingsVsSource > 0) {
      sourceComparisonBanner.classList.remove('is-best-source');
      textSpan.textContent = `💰 Economisești ${formatLei(sourceComparison.savingsVsSource)} față de ${sourceName} (cost total acolo: ${formatLei(sourceComparison.sourceTotalCost)}).`;
    } else {
      sourceComparisonBanner.classList.add('is-best-source');
      textSpan.textContent = `Cost total estimat pe ${sourceName}: ${formatLei(sourceComparison.sourceTotalCost)}.`;
    }

    sourceComparisonBanner.append(textSpan);
  }

  function renderStockPill(td, stock) {
    const verificationState = stock?.verificationState || 'unverified_unknown';
    const pill = document.createElement('span');

    let statusClass = 'status-low';
    if (verificationState === 'verified_in_stock') statusClass = 'status-in';
    else if (verificationState === 'verified_out_of_stock' || stock?.status === 'out_of_stock') statusClass = 'status-out';

    pill.className = `status-pill ${statusClass}`;
    pill.textContent = stock?.label || (
      verificationState === 'verified_in_stock'
        ? 'În stoc'
        : verificationState === 'verified_out_of_stock'
          ? 'Stoc epuizat'
          : 'Stoc neverificat'
    );
    td.append(pill);

    if (Array.isArray(stock?.availableSizes) && stock.availableSizes.length > 0) {
      const sizesSmall = document.createElement('span');
      sizesSmall.className = 'sizes-list';
      sizesSmall.textContent = `Disp: ${stock.availableSizes.join(', ')}`;
      td.append(sizesSmall);
    }
  }

  function renderOtherVariants(otherVariants) {
    otherVariantsTbody.replaceChildren();
    if (!Array.isArray(otherVariants) || otherVariants.length === 0) {
      otherVariantsDetails.hidden = true;
      return;
    }

    otherVariantsDetails.hidden = false;
    otherVariantsSummary.textContent = `Alte variante (${otherVariants.length})`;

    otherVariants.forEach((offer) => {
      const tr = document.createElement('tr');

      const tdStore = document.createElement('td');
      const storeDiv = document.createElement('div');
      storeDiv.className = 'store-cell';
      const sName = document.createElement('span');
      sName.className = 'store-name';
      sName.textContent = offer.storeName;
      const sProd = document.createElement('span');
      sProd.className = 'store-domain';
      sProd.textContent = offer.productTitle || offer.title || offer.domain;
      storeDiv.append(sName, sProd);
      const badges = buildOfferBadges(offer);
      if (badges.length > 0) {
        const badgeRow = document.createElement('div');
        badgeRow.className = 'badge-row';
        badgeRow.append(...badges);
        storeDiv.append(badgeRow);
      }
      tdStore.append(storeDiv);

      const tdUnit = document.createElement('td');
      const priceStr = formatLei(offer.discountedPrice ?? offer.price);
      tdUnit.textContent = offer.unitPriceLabel ? `${priceStr} (${offer.unitPriceLabel})` : priceStr;

      const tdTotal = document.createElement('td');
      const totalSpan = document.createElement('span');
      totalSpan.className = 'total-price';
      totalSpan.textContent = isUnknownShipping(offer)
        ? `${formatLei(offer.discountedPrice ?? offer.price)} + transp.`
        : formatLei(offer.totalCost);
      tdTotal.append(totalSpan);

      const tdStock = document.createElement('td');
      renderStockPill(tdStock, offer.stock);

      const tdAction = document.createElement('td');
      tdAction.append(createSafeLink(offer.url, 'Cumpără ↗'));

      tr.append(tdStore, tdUnit, tdTotal, tdStock, tdAction);
      otherVariantsTbody.append(tr);
    });
  }

  function renderStoreHealthStrip(storeHealth) {
    storeHealthStrip.replaceChildren();
    if (!storeHealth || typeof storeHealth !== 'object') {
      storeHealthStrip.hidden = true;
      return;
    }

    const entries = Array.isArray(storeHealth)
      ? storeHealth
      : Object.entries(storeHealth).map(([storeId, info]) => ({ storeId, ...info }));

    if (entries.length === 0) {
      storeHealthStrip.hidden = true;
      return;
    }

    const degraded = entries.filter((e) => (
      e.state === 'blocked'
      || e.state === 'parse_error'
      || e.state === 'degraded'
      || e.circuitState === 'OPEN'
      || e.circuitState === 'HALF_OPEN'
    ));
    const liveHealthyCount = entries.filter((e) => (
      e.state === 'healthy'
      || (e.circuitState === 'CLOSED' && e.state !== 'serper_or_manual' && !degraded.includes(e))
    )).length;
    const serperManualCount = entries.filter((e) => e.state === 'serper_or_manual').length;

    const label = document.createElement('span');
    label.className = 'health-strip-label';
    label.textContent = serperManualCount > 0
      ? `Surse: ${liveHealthyCount} live active • ${serperManualCount} Serper/manual`
      : `Surse live: ${liveHealthyCount}/${entries.length} active`;
    storeHealthStrip.append(label);

    if (degraded.length === 0) {
      const okPill = document.createElement('span');
      okPill.className = 'health-pill health-closed';
      okPill.textContent = 'Adaptoare live sănătoase';
      storeHealthStrip.append(okPill);
    } else {
      degraded.slice(0, 8).forEach((item) => {
        const pill = document.createElement('span');
        const isHalf = item.circuitState === 'HALF_OPEN' || item.state === 'degraded';
        pill.className = `health-pill ${isHalf ? 'health-half' : 'health-open'}`;
        const storeName = item.storeName || state.storesById.get(item.storeId)?.name || item.storeId;
        const reason = item.reason || item.lastFailureKind || (isHalf ? 'degradat' : 'blocat/pauză');
        pill.textContent = `${storeName}: ${reason}`;
        storeHealthStrip.append(pill);
      });
      if (degraded.length > 8) {
        const more = document.createElement('span');
        more.className = 'muted';
        more.textContent = `+${degraded.length - 8} alte surse limitate`;
        storeHealthStrip.append(more);
      }
    }

    storeHealthStrip.hidden = false;
  }

  function renderResults(data) {
    const isSized = isSizedCategory(data.detectedCategory);
    onlyInStockWrap.hidden = !(isSized && data.desiredSize);

    const allExactOffers = Array.isArray(data.offers) ? data.offers : [];
    const visibleOffers = isSized && data.desiredSize && onlyInStockToggle.checked
      ? allExactOffers.filter((o) => o.stock?.hasDesiredSize !== false)
      : allExactOffers;

    const bestOffer = data.bestDeal || visibleOffers[0] || null;

    renderSourceComparisonBanner(data.sourceComparison);

    // Render Winner Card safely
    winnerCard.replaceChildren();
    if (bestOffer) {
      winnerCard.hidden = false;
      const left = document.createElement('div');
      const eyebrow = document.createElement('span');
      const vState = bestOffer.stock?.verificationState || 'unverified_unknown';

      if (vState === 'verified_in_stock') {
        eyebrow.className = 'winner-eyebrow';
        eyebrow.textContent = '🏆 Cel mai mic cost total real (Verificat Live)';
      } else if (vState === 'verified_out_of_stock') {
        eyebrow.className = 'winner-eyebrow is-oos';
        eyebrow.textContent = '⚠ Cel mai mic preț găsit (Stoc epuizat / Mărime indisponibilă)';
      } else {
        eyebrow.className = 'winner-eyebrow is-unverified';
        eyebrow.textContent = '⚠ Cel mai mic preț găsit (Stoc neverificat)';
      }

      const title = document.createElement('h3');
      title.className = 'winner-title';
      title.textContent = `${bestOffer.storeName} — ${bestOffer.productTitle || bestOffer.title || data.query}`;

      const breakdown = document.createElement('p');
      breakdown.className = 'winner-breakdown';
      const prodPrice = bestOffer.discountedPrice ?? bestOffer.price;
      const shipTxt = isUnknownShipping(bestOffer)
        ? '+ transport la checkout'
        : bestOffer.shippingFee === 0
          ? `Transport GRATUIT (${bestOffer.shippingReason || 'standard'})`
          : `Transport ${formatLei(bestOffer.shippingFee)} (${bestOffer.shippingReason || 'standard'})`;
      const rambursTxt = bestOffer.rambursFee > 0 ? ` + Ramburs ${formatLei(bestOffer.rambursFee)}` : '';
      const deliveryTxt = bestOffer.deliveryDays ? ` • Livrare ${bestOffer.deliveryDays}` : '';
      breakdown.textContent = `Produs: ${formatLei(prodPrice)} • ${shipTxt}${rambursTxt}${deliveryTxt}`;

      left.append(eyebrow, title, breakdown);

      const winnerBadges = buildOfferBadges(bestOffer);
      if (winnerBadges.length > 0) {
        const badgeRow = document.createElement('div');
        badgeRow.className = 'badge-row';
        badgeRow.append(...winnerBadges);
        left.append(badgeRow);
      }

      if (typeof data.maxSavings === 'number' && data.maxSavings > 5) {
        const saveNote = document.createElement('p');
        saveNote.className = 'winner-breakdown';
        saveNote.style.marginTop = '0.35rem';
        saveNote.append('Economisești până la ');
        const strongSave = document.createElement('strong');
        strongSave.textContent = formatLei(data.maxSavings);
        saveNote.append(strongSave, ' față de cea mai scumpă ofertă exactă găsită.');
        left.append(saveNote);
      }

      const right = document.createElement('div');
      right.className = 'winner-cta';

      const totalEl = document.createElement('div');
      totalEl.className = 'winner-total';
      totalEl.textContent = isUnknownShipping(bestOffer)
        ? `${formatLei(prodPrice)} + transport`
        : formatLei(bestOffer.totalCost);

      const ctaLink = createSafeLink(bestOffer.url, `Vezi pe ${bestOffer.storeName} ↗`, 'btn-primary');
      if (ctaLink.tagName === 'A') {
        ctaLink.style.textDecoration = 'none';
      }

      right.append(totalEl, ctaLink);
      winnerCard.append(left, right);
    } else {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `Nu am găsit oferte automate directe pentru „${data.query}”. Folosește link-urile directe de mai jos pentru a verifica magazinele din România.`;
      winnerCard.append(p);
    }

    resultsHeading.textContent = `Oferte reale găsite pentru „${data.query}”`;
    let serperNote = '';
    if (data.serperInfo?.used) {
      serperNote = data.serperInfo.error
        ? ` • ⚠ Serper: ${data.serperInfo.error}`
        : ` • 🌐 Google RO: ${data.serperInfo.shoppingCount || 0} Shopping + ${data.serperInfo.webCount || 0} Web`;
    }
    const foundCount = data.totalOffersFound ?? allExactOffers.length;
    const checkedTxt = data.totalStoresChecked ? `${data.totalStoresChecked} magazine verificate • ` : '';
    resultsSubhead.textContent = `Categorie: ${CAT_LABELS[data.detectedCategory] || 'General'} • ${checkedTxt}${foundCount} oferte potrivite${data.desiredSize ? ` • Mărimea ${data.desiredSize}: ${data.inStockCount} confirmate` : ''}${serperNote}`;

    const freshnessTxt = formatCacheFreshness(data.cacheStatus, data.cachedAt);
    cacheBar.hidden = false;
    cacheFreshnessText.textContent = freshnessTxt;

    // Render Table Rows
    resultsTbody.replaceChildren();
    if (visibleOffers.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = allExactOffers.length > 0
        ? `Nicio ofertă nu are mărimea ${data.desiredSize} disponibilă conform filtrului curent. Debifează filtrul de mai sus.`
        : `Nicio ofertă extrasă automat pentru „${data.query}”. Verifică magazinele directe de mai jos.`;
      tr.append(td);
      resultsTbody.append(tr);
    } else {
      visibleOffers.forEach((offer) => {
        const tr = document.createElement('tr');
        if (bestOffer && offer.url === bestOffer.url) tr.classList.add('is-best');
        if (offer.stock?.verificationState === 'verified_out_of_stock' || offer.stock?.hasDesiredSize === false) {
          tr.classList.add('is-oos');
        }

        // 1. Magazin + Produs + Badges
        const tdStore = document.createElement('td');
        const storeDiv = document.createElement('div');
        storeDiv.className = 'store-cell';
        const sName = document.createElement('span');
        sName.className = 'store-name';
        sName.textContent = offer.storeName;
        const sProd = document.createElement('span');
        sProd.className = 'store-domain';
        sProd.textContent = offer.productTitle || offer.title || `${offer.domain} • ${offer.deliveryDays || ''}`;
        storeDiv.append(sName, sProd);
        const badges = buildOfferBadges(offer);
        if (badges.length > 0) {
          const badgeRow = document.createElement('div');
          badgeRow.className = 'badge-row';
          badgeRow.append(...badges);
          storeDiv.append(badgeRow);
        }
        tdStore.append(storeDiv);

        // 2. Pret produs
        const tdPrice = document.createElement('td');
        const priceVal = offer.discountedPrice ?? offer.price;
        tdPrice.textContent = formatLei(priceVal);
        if (offer.voucherApplied && offer.originalPrice && offer.originalPrice > priceVal) {
          const origSmall = document.createElement('small');
          origSmall.className = 'sizes-list';
          origSmall.textContent = `Fără voucher: ${formatLei(offer.originalPrice)}`;
          tdPrice.append(origSmall);
        }

        // 3. Transport
        const tdShip = document.createElement('td');
        if (isUnknownShipping(offer)) {
          const unk = document.createElement('span');
          unk.className = 'shipping-unknown';
          unk.textContent = '+ transport la checkout';
          tdShip.append(unk);
        } else {
          tdShip.textContent = offer.shippingFee === 0 ? 'Gratuit' : formatLei(offer.shippingFee);
        }
        if (offer.shippingReason) tdShip.title = offer.shippingReason;

        // 4. Ramburs
        const tdRamburs = document.createElement('td');
        if (offer.rambursAllowed === false) {
          tdRamburs.textContent = 'Doar card';
          if (offer.rambursReason) tdRamburs.title = offer.rambursReason;
        } else {
          tdRamburs.textContent = offer.rambursFee === 0 ? '0,00 lei' : formatLei(offer.rambursFee);
          if (offer.rambursReason) tdRamburs.title = offer.rambursReason;
        }

        // 5. Total
        const tdTotal = document.createElement('td');
        const totalSpan = document.createElement('span');
        totalSpan.className = 'total-price';
        totalSpan.textContent = isUnknownShipping(offer)
          ? `${formatLei(priceVal)} + transp.`
          : formatLei(offer.totalCost);
        tdTotal.append(totalSpan);

        // 6. Stoc & Marime
        const tdStock = document.createElement('td');
        renderStockPill(tdStock, offer.stock);

        // 7. Actiune
        const tdAction = document.createElement('td');
        tdAction.append(createSafeLink(offer.url, 'Cumpără ↗'));

        tr.append(tdStore, tdPrice, tdShip, tdRamburs, tdTotal, tdStock, tdAction);
        resultsTbody.append(tr);
      });
    }

    // Collapsible Alte variante
    renderOtherVariants(data.otherVariantOffers);

    // Manual Stores Section
    manualStoresBox.replaceChildren();
    if (data.manualStores && data.manualStores.length > 0) {
      const h3 = document.createElement('h3');
      h3.textContent = 'Verifică direct și pe alte magazine din România';
      const sub = document.createElement('p');
      sub.className = 'muted';
      sub.textContent = 'Aceste magazine necesită verificare directă sau nu au returnat o potrivire exactă, dar poți deschide căutarea cu regulile lor de transport:';

      const grid = document.createElement('div');
      grid.className = 'manual-grid';
      data.manualStores.forEach((ms) => {
        const card = document.createElement('div');
        card.className = 'manual-card';
        const name = document.createElement('strong');
        name.textContent = ms.storeName;

        const info = document.createElement('small');
        let shipTxt;
        if (ms.bulkyPolicy === 'dynamic_checkout_only' || ms.shippingState === 'unknown_checkout' || ms.baseShipping === null || ms.baseShipping === undefined) {
          shipTxt = 'Transport calculat la checkout';
        } else if (ms.baseShipping === 0) {
          shipTxt = 'Transport gratuit';
        } else if (ms.freeThreshold) {
          shipTxt = `Transport ${formatLei(ms.baseShipping)} (gratuit > ${ms.freeThreshold} lei)`;
        } else {
          shipTxt = `Transport ${formatLei(ms.baseShipping)}`;
        }
        const rambTxt = ms.rambursFee > 0 ? ` • Ramburs ${formatLei(ms.rambursFee)}` : '';
        info.textContent = `${shipTxt}${rambTxt}`;

        const a = createSafeLink(ms.url, `Caută pe ${ms.storeName} ↗`);
        card.append(name, info, a);
        grid.append(card);
      });
      manualStoresBox.append(h3, sub, grid);
      manualStoresBox.hidden = false;
    } else {
      manualStoresBox.hidden = true;
    }

    // Store Health Status Strip
    renderStoreHealthStrip(data.storeHealth);
  }

  // --- Form 1: Name ---
  formName.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!nameInput.checkValidity()) {
      if (!CSS.supports('selector(:user-invalid)')) nameInput.classList.add('user-invalid-fallback');
      syncAriaValidation(nameInput);
      nameInput.focus();
      return;
    }
    state.sourceOffer = null;
    runSearch(nameInput.value.trim(), { sourceOffer: null });
  });

  // --- Form 2: URL Analysis + Confirmation ---
  formLink.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!urlInput.checkValidity()) {
      if (!CSS.supports('selector(:user-invalid)')) urlInput.classList.add('user-invalid-fallback');
      syncAriaValidation(urlInput);
      urlInput.focus();
      return;
    }

    const rawUrl = urlInput.value.trim();
    if (!safeHttpUrl(rawUrl)) {
      urlPreviewBox.hidden = false;
      urlPreviewBox.textContent = 'Introdu un link valid care începe cu https:// sau http://.';
      return;
    }

    urlPreviewBox.hidden = false;
    urlPreviewBox.textContent = 'Se analizează link-ul și se extrage produsul...';
    formLinkConfirm.hidden = true;

    try {
      const resp = await fetch('/api/analyze-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Nu am putut analiza link-ul.');

      urlPreviewBox.replaceChildren();
      const safeImage = safeHttpUrl(data.image);
      if (safeImage) {
        const img = document.createElement('img');
        img.src = safeImage;
        img.alt = data.title || 'Produs analizat';
        urlPreviewBox.append(img);
      }

      const info = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = data.title || data.distilledQuery || data.domain;

      const meta = document.createElement('p');
      meta.className = 'muted';
      const parts = [`Sursă: ${data.domain || 'link'}`];
      if (data.price) parts.push(`Preț găsit: ${formatLei(data.price)}`);
      if (data.scrapedLive === false) parts.push('extras din URL (protecție site)');
      meta.textContent = parts.join(' • ');

      info.append(strong, meta);
      urlPreviewBox.append(info);

      const confirmedQuery = data.distilledQuery || data.title || '';
      linkQueryInput.value = confirmedQuery;
      formLinkConfirm.hidden = false;

      if (categorySelect.value === 'auto' && data.detectedCategory) {
        updateSizeSelector(data.detectedCategory, sizeSelect.value);
      }

      const sourceOffer = data.sourceOffer || (data.price ? {
        storeId: data.storeId || null,
        domain: data.domain || '',
        title: data.title || confirmedQuery,
        price: data.price,
        url: rawUrl,
      } : null);

      if (confirmedQuery.length >= 2) {
        runSearch(confirmedQuery, { sourceOffer });
      }
    } catch (err) {
      urlPreviewBox.textContent = err.message;
    }
  });

  formLinkConfirm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!linkQueryInput.checkValidity()) {
      if (!CSS.supports('selector(:user-invalid)')) linkQueryInput.classList.add('user-invalid-fallback');
      syncAriaValidation(linkQueryInput);
      linkQueryInput.focus();
      return;
    }
    runSearch(linkQueryInput.value.trim(), { sourceOffer: state.sourceOffer });
  });

  // --- Form 3: Photo Upload / Paste / Proxied Gemini Vision ---
  function cleanFilenameToQuery(filename) {
    return filename
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b(img|image|screenshot|photo|whatsapp|dsc|pxl)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function revokeCurrentPhotoUrl() {
    if (state.currentPhotoObjectUrl) {
      URL.revokeObjectURL(state.currentPhotoObjectUrl);
      state.currentPhotoObjectUrl = null;
    }
  }

  // Vercel caps request bodies at 4.5 MB, so large phone photos are downscaled
  // before upload. Small screenshots are left untouched to preserve OCR text.
  async function prepareImageForUpload(file) {
    if (!file || file.size <= 2.5 * 1024 * 1024) return file;
    try {
      const bitmap = await createImageBitmap(file);
      const maxSide = 1600;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      if (typeof bitmap.close === 'function') bitmap.close();
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      return blob && blob.size < file.size ? blob : file;
    } catch {
      return file;
    }
  }

  async function identifyWithServerProxy(file, apiKey) {
    const uploadFile = await prepareImageForUpload(file);
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resultStr = String(reader.result || '');
        const idx = resultStr.indexOf(',');
        resolve(idx >= 0 ? resultStr.slice(idx + 1) : resultStr);
      };
      reader.onerror = reject;
      reader.readAsDataURL(uploadFile);
    });

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['X-Gemini-Key'] = apiKey;
    }

    const resp = await fetch('/api/identify-image', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        base64,
        mimeType: uploadFile.type || 'image/jpeg',
      }),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || 'Gemini identify error');
    }
    return resp.json();
  }

  // Browser-side OCR keeps photo recognition keyless on Vercel: serverless WASM
  // init hangs there, while the browser already has a working WASM runtime.
  let browserOcrWorkerPromise = null;

  function getBrowserOcrWorker() {
    if (!browserOcrWorkerPromise) {
      const Tesseract = window.Tesseract;
      if (!Tesseract || typeof Tesseract.createWorker !== 'function') {
        throw new Error('OCR nu este disponibil în acest browser.');
      }
      browserOcrWorkerPromise = Tesseract.createWorker('eng', 1, {
        workerPath: '/vendor/tesseract/worker.min.js',
        corePath: '/vendor/tesseract/',
        langPath: '/vendor/tesseract/',
        workerBlobURL: false,
        logger: () => {},
      }).catch((err) => {
        browserOcrWorkerPromise = null;
        throw err;
      });
    }
    return browserOcrWorkerPromise;
  }

  async function identifyWithBrowserOcr(file) {
    const parser = window.FrugalOcrParse;
    if (!parser || typeof parser.buildResult !== 'function') {
      throw new Error('Parserul OCR nu este disponibil.');
    }
    const worker = await getBrowserOcrWorker();
    const prepared = await prepareImageForUpload(file);
    const { data } = await worker.recognize(prepared);
    const lines = String(data?.text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = parser.buildResult(lines);
    if (!parsed) return null;
    return {
      ...parsed,
      source: 'local_ocr',
      needsConfirmation: parsed.confidence < 0.75,
    };
  }

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    revokeCurrentPhotoUrl();
    const objectUrl = URL.createObjectURL(file);
    state.currentPhotoObjectUrl = objectUrl;
    photoPreviewImg.src = objectUrl;
    photoFileName.textContent = file.name || 'Imagine lipită din clipboard';
    dropzoneEmpty.hidden = true;
    dropzonePreview.hidden = false;

    const guessed = cleanFilenameToQuery(file.name || '');
    if (guessed.length >= 2) {
      photoQueryInput.value = guessed;
    }

    const apiKey = getStoredKey(GEMINI_KEY_STORAGE);
    photoAiStatus.textContent = apiKey
      ? '✨ Se identifică produsul cu Gemini Vision...'
      : '✨ Se citește textul din imagine (OCR în browser)...';

    try {
      const result = apiKey
        ? await identifyWithServerProxy(file, apiKey)
        : await identifyWithBrowserOcr(file);
      if (result?.query) {
        photoQueryInput.value = result.query;
        const label = result.source === 'local_ocr' ? 'Identificat din imagine' : 'Identificat automat';
        const confirmHint = result.needsConfirmation ? ' — confirmă mai jos' : '';
        photoAiStatus.textContent = `✨ ${label}: ${result.query}${confirmHint}`;
      } else {
        photoAiStatus.textContent = 'Poți scrie sau confirma numele produsului mai jos.';
      }
      if (result?.category && categorySelect.value === 'auto') {
        categorySelect.value = result.category;
        updateSizeSelector(result.category, String(result.size || '').replace(/^eu\s*/i, '').trim());
      }
      if (result?.size && categorySelect.value !== 'auto') {
        const detectedSize = String(result.size).replace(/^eu\s*/i, '').trim();
        if ([...sizeSelect.options].some((opt) => opt.value === detectedSize)) {
          sizeSelect.value = detectedSize;
        }
      }
    } catch (err) {
      photoAiStatus.textContent = apiKey
        ? 'Nu am putut identifica automat produsul. Confirmă numele mai jos.'
        : `Nu am putut citi produsul din imagine. ${err?.message || 'Scrie numele manual.'}`;
    }
  }

  photoFileInput.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleImageFile(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    photoDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      photoDropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    photoDropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      photoDropzone.classList.remove('drag-over');
    });
  });

  photoDropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file) handleImageFile(file);
  });

  document.addEventListener('paste', (e) => {
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          selectTab(tabs[2]);
          handleImageFile(file);
          break;
        }
      }
    }
  });

  clearPhotoBtn.addEventListener('click', () => {
    revokeCurrentPhotoUrl();
    photoFileInput.value = '';
    photoPreviewImg.removeAttribute('src');
    dropzonePreview.hidden = true;
    dropzoneEmpty.hidden = false;
    photoAiStatus.textContent = '';
  });

  formPhoto.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!photoQueryInput.checkValidity()) {
      if (!CSS.supports('selector(:user-invalid)')) photoQueryInput.classList.add('user-invalid-fallback');
      syncAriaValidation(photoQueryInput);
      photoQueryInput.focus();
      return;
    }
    state.sourceOffer = null;
    runSearch(photoQueryInput.value.trim(), { sourceOffer: null });
  });

  // --- Settings Modal ---
  openSettingsBtn.addEventListener('click', () => {
    serperKeyInput.value = getStoredKey(SERPER_KEY_STORAGE);
    geminiKeyInput.value = getStoredKey(GEMINI_KEY_STORAGE);
    rememberKeysCheck.checked = isRememberKeysEnabled();
    settingsDialog.showModal();
  });

  saveKeyBtn.addEventListener('click', () => {
    const serperVal = serperKeyInput.value.trim();
    const geminiVal = geminiKeyInput.value.trim();
    saveStoredKeys(serperVal, geminiVal, rememberKeysCheck.checked);
    settingsDialog.close();
  });

  clearKeyBtn.addEventListener('click', () => {
    clearStoredKeys();
    serperKeyInput.value = '';
    geminiKeyInput.value = '';
    rememberKeysCheck.checked = false;
    settingsDialog.close();
  });
})();
