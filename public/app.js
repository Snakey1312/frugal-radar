(() => {
  'use strict';

  const SHOE_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46'];
  const CLOTHES_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
  const GEMINI_KEY_STORAGE = 'frugalradar_gemini_key';
  const SERPER_KEY_STORAGE = 'frugalradar_serper_key';

  const state = {
    lastQuery: '',
    lastSourcePrice: null,
    lastResult: null,
  };

  // Elements
  const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
  const panels = Array.from(document.querySelectorAll('[role="tabpanel"]'));

  const formName = document.getElementById('form-name');
  const formLink = document.getElementById('form-link');
  const formPhoto = document.getElementById('form-photo');

  const nameInput = document.getElementById('product-name-input');
  const urlInput = document.getElementById('product-url-input');
  const urlPreviewBox = document.getElementById('url-preview-box');

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
  const geniusEmagCheck = document.getElementById('genius-emag');
  const geniusFashionCheck = document.getElementById('genius-fashion');

  const resultsSection = document.getElementById('results-section');
  const winnerCard = document.getElementById('winner-card');
  const resultsHeading = document.getElementById('results-heading');
  const resultsSubhead = document.getElementById('results-subhead');
  const onlyInStockToggle = document.getElementById('only-in-stock-toggle');
  const onlyInStockWrap = document.getElementById('only-in-stock-wrap');
  const resultsTbody = document.getElementById('results-tbody');

  const settingsDialog = document.getElementById('settings-dialog');
  const openSettingsBtn = document.getElementById('open-settings-btn');
  const serperKeyInput = document.getElementById('serper-key-input');
  const geminiKeyInput = document.getElementById('gemini-key-input');
  const saveKeyBtn = document.getElementById('save-key-btn');
  const clearKeyBtn = document.getElementById('clear-key-btn');

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

  // --- Size Options ---
  function updateSizeSelector(category, preserveSize = '') {
    const current = preserveSize || sizeSelect.value;
    sizeSelect.innerHTML = '';

    if (category === 'electronics' || category === 'general') {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nu necesită mărime';
      sizeSelect.append(opt);
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

    const list = category === 'clothes' ? CLOTHES_SIZES : [...SHOE_SIZES, ...CLOTHES_SIZES];
    list.forEach((sz) => {
      const opt = document.createElement('option');
      opt.value = sz;
      opt.textContent = category === 'shoes' ? `EU ${sz}` : sz;
      if (sz === current) opt.selected = true;
      sizeSelect.append(opt);
    });
  }

  updateSizeSelector('auto');

  categorySelect.addEventListener('change', () => {
    updateSizeSelector(categorySelect.value);
    if (state.lastQuery) runSearch(state.lastQuery, state.lastSourcePrice);
  });

  [sizeSelect, deliverySelect, paymentSelect, voucherInput, geniusEmagCheck, geniusFashionCheck].forEach((ctrl) => {
    ctrl.addEventListener('change', () => {
      if (state.lastQuery) runSearch(state.lastQuery, state.lastSourcePrice);
    });
  });

  onlyInStockToggle.addEventListener('change', () => {
    if (state.lastResult) renderResults(state.lastResult);
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
      runSearch(query, null);
    });
  });

  // --- Formatting ---
  function formatLei(amount) {
    return `${Number(amount).toLocaleString('ro-RO', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })} lei`;
  }

  // --- Search API ---
  async function runSearch(query, sourcePrice = null) {
    state.lastQuery = query;
    state.lastSourcePrice = sourcePrice;

    announcer.textContent = `Caut ${query} pe magazinele românești...`;
    resultsSection.hidden = false;
    winnerCard.innerHTML = '<p class="muted">Se caută cele mai bune prețuri și stocurile pe site-urile din România...</p>';

    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          category: categorySelect.value,
          size: sizeSelect.value,
          deliveryType: deliverySelect.value,
          paymentMethod: paymentSelect.value,
          voucherPercent: Number(voucherInput.value) || 0,
          geniusEmag: geniusEmagCheck.checked,
          geniusFashion: geniusFashionCheck.checked,
          serperKey: localStorage.getItem(SERPER_KEY_STORAGE) || '',
          sourcePrice,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Eroare la căutare.');
      }

      state.lastResult = data;

      // Sync size selector if auto-detected shoes/clothes
      if (categorySelect.value === 'auto' && data.detectedCategory) {
        updateSizeSelector(data.detectedCategory, data.desiredSize);
      }

      renderResults(data);
      announcer.textContent = `Am găsit ${data.totalStoresChecked} oferte pentru ${data.query}.`;
    } catch (err) {
      winnerCard.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'error-msg';
      p.style.display = 'block';
      p.textContent = err.message;
      winnerCard.append(p);
    }
  }

  function renderResults(data) {
    const isSized = data.detectedCategory === 'shoes' || data.detectedCategory === 'clothes';
    onlyInStockWrap.hidden = !(isSized && data.desiredSize);

    const visibleOffers = isSized && data.desiredSize && onlyInStockToggle.checked
      ? data.offers.filter((o) => o.stock.hasDesiredSize)
      : data.offers;

    const bestOffer = data.offers.find((o) => o.url === data.bestDealUrl) || visibleOffers[0];

    // Render Winner Card safely
    winnerCard.innerHTML = '';
    if (bestOffer) {
      winnerCard.hidden = false;
      const left = document.createElement('div');
      const eyebrow = document.createElement('span');
      eyebrow.className = 'winner-eyebrow';
      eyebrow.textContent = bestOffer.stock.hasDesiredSize
        ? '🏆 Cel mai mic cost total real (Verificat Live)'
        : '⚠ Cel mai mic preț găsit (Verifică mărimea)';

      const title = document.createElement('h3');
      title.className = 'winner-title';
      title.textContent = `${bestOffer.storeName} — ${bestOffer.productTitle || data.query}`;

      const breakdown = document.createElement('p');
      breakdown.className = 'winner-breakdown';
      const shipTxt = bestOffer.shippingFee === 0 ? 'Transport GRATUIT' : `Transport ${formatLei(bestOffer.shippingFee)}`;
      const rambursTxt = bestOffer.rambursFee > 0 ? ` + Ramburs ${formatLei(bestOffer.rambursFee)}` : '';
      breakdown.textContent = `Produs: ${formatLei(bestOffer.discountedPrice)} + ${shipTxt} (${bestOffer.shippingReason})${rambursTxt} • Livrare ${bestOffer.deliveryDays}`;

      left.append(eyebrow, title, breakdown);

      if (data.maxSavings > 5) {
        const saveNote = document.createElement('p');
        saveNote.className = 'winner-breakdown';
        saveNote.style.marginTop = '0.35rem';
        saveNote.innerHTML = `Economisești până la <strong>${formatLei(data.maxSavings)}</strong> față de cea mai scumpă ofertă găsită.`;
        left.append(saveNote);
      }

      const right = document.createElement('div');
      right.className = 'winner-cta';

      const totalEl = document.createElement('div');
      totalEl.className = 'winner-total';
      totalEl.textContent = formatLei(bestOffer.totalCost);

      const link = document.createElement('a');
      link.href = bestOffer.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'btn-primary';
      link.style.textDecoration = 'none';
      link.textContent = `Vezi pe ${bestOffer.storeName} ↗`;

      right.append(totalEl, link);
      winnerCard.append(left, right);
    } else {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = `Nu am găsit oferte automate directe pentru „${data.query}”. Folosește link-urile directe de mai jos pentru a verifica magazinele din România.`;
      winnerCard.append(p);
    }

    const catLabels = {
      shoes: 'Încălțăminte',
      clothes: 'Haine',
      electronics: 'Electronice / IT',
      supplements: 'Suplimente / Sport',
      general: 'General',
    };
    resultsHeading.textContent = `Oferte reale găsite pentru „${data.query}”`;
    let serperNote = '';
    if (data.serperInfo?.used) {
      serperNote = data.serperInfo.error
        ? ` • ⚠ Serper: ${data.serperInfo.error}`
        : ` • 🌐 Google RO: ${data.serperInfo.shoppingCount} Shopping + ${data.serperInfo.webCount} Web`;
    }
    resultsSubhead.textContent = `Categorie: ${catLabels[data.detectedCategory] || 'General'} • ${data.totalStoresChecked} oferte verificate live${data.desiredSize ? ` • Mărimea ${data.desiredSize}: ${data.inStockCount} disponibile` : ''}${serperNote}`;

    // Render Table Rows
    resultsTbody.innerHTML = '';
    if (visibleOffers.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = data.offers.length > 0
        ? `Nicio ofertă nu are mărimea ${data.desiredSize} confirmată în stoc. Debifează filtrul de mai sus.`
        : `Nicio ofertă extrasă automat pentru „${data.query}”. Verifică magazinele directe de mai jos.`;
      tr.append(td);
      resultsTbody.append(tr);
    } else {
      visibleOffers.forEach((offer) => {
        const tr = document.createElement('tr');
        if (offer.url === data.bestDealUrl) tr.classList.add('is-best');
        if (!offer.stock.hasDesiredSize) tr.classList.add('is-oos');

        // 1. Magazin + Produs real
        const tdStore = document.createElement('td');
        const storeDiv = document.createElement('div');
        storeDiv.className = 'store-cell';
        const sName = document.createElement('span');
        sName.className = 'store-name';
        sName.textContent = offer.storeName;
        const sProd = document.createElement('span');
        sProd.className = 'store-domain';
        sProd.textContent = offer.productTitle || `${offer.domain} • ${offer.deliveryDays}`;
        storeDiv.append(sName, sProd);
        tdStore.append(storeDiv);

        // 2. Pret produs
        const tdPrice = document.createElement('td');
        tdPrice.textContent = formatLei(offer.discountedPrice);

        // 3. Transport
        const tdShip = document.createElement('td');
        tdShip.textContent = offer.shippingFee === 0 ? 'Gratuit' : formatLei(offer.shippingFee);
        tdShip.title = offer.shippingReason;

        // 4. Ramburs
        const tdRamburs = document.createElement('td');
        tdRamburs.textContent = offer.rambursFee === 0 ? '0,00 lei' : formatLei(offer.rambursFee);

        // 5. Total
        const tdTotal = document.createElement('td');
        const totalSpan = document.createElement('span');
        totalSpan.className = 'total-price';
        totalSpan.textContent = formatLei(offer.totalCost);
        tdTotal.append(totalSpan);

        // 6. Stoc & Marime
        const tdStock = document.createElement('td');
        const pill = document.createElement('span');
        const statusClass = offer.stock.status === 'out_of_stock'
          ? 'status-out'
          : offer.stock.status === 'low_stock'
            ? 'status-low'
            : 'status-in';
        pill.className = `status-pill ${statusClass}`;
        pill.textContent = offer.stock.label;
        tdStock.append(pill);

        if (offer.stock.requiresSize && offer.stock.availableSizes.length > 0) {
          const sizesSmall = document.createElement('span');
          sizesSmall.className = 'sizes-list';
          sizesSmall.textContent = `Disp: ${offer.stock.availableSizes.join(', ')}`;
          tdStock.append(sizesSmall);
        }

        // 7. Actiune
        const tdAction = document.createElement('td');
        const link = document.createElement('a');
        link.href = offer.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.className = 'btn-link';
        link.textContent = 'Cumpără ↗';
        tdAction.append(link);

        tr.append(tdStore, tdPrice, tdShip, tdRamburs, tdTotal, tdStock, tdAction);
        resultsTbody.append(tr);
      });
    }

    // Render Manual Stores Section (stores that block bots or had no auto-match)
    let manualBox = document.getElementById('manual-stores-box');
    if (!manualBox) {
      manualBox = document.createElement('div');
      manualBox.id = 'manual-stores-box';
      manualBox.className = 'manual-stores-box';
      resultsSection.append(manualBox);
    }
    manualBox.innerHTML = '';
    if (data.manualStores && data.manualStores.length > 0) {
      const h3 = document.createElement('h3');
      h3.textContent = 'Verifică direct și pe alte magazine din România';
      const sub = document.createElement('p');
      sub.className = 'muted';
      sub.textContent = 'Aceste magazine blochează verificarea automată sau nu au returnat o potrivire exactă, dar poți deschide căutarea directă cu regulile lor de transport:';

      const grid = document.createElement('div');
      grid.className = 'manual-grid';
      data.manualStores.forEach((ms) => {
        const card = document.createElement('div');
        card.className = 'manual-card';
        const name = document.createElement('strong');
        name.textContent = ms.storeName;
        const info = document.createElement('small');
        const shipTxt = ms.baseShipping === 0 ? 'Transport gratuit' : `Transport ${formatLei(ms.baseShipping)} (gratuit > ${ms.freeThreshold} lei)`;
        const rambTxt = ms.rambursFee > 0 ? ` • Ramburs ${formatLei(ms.rambursFee)}` : '';
        info.textContent = `${shipTxt}${rambTxt}`;
        const a = document.createElement('a');
        a.href = ms.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'btn-link';
        a.textContent = `Caută pe ${ms.storeName} ↗`;
        card.append(name, info, a);
        grid.append(card);
      });
      manualBox.append(h3, sub, grid);
      manualBox.hidden = false;
    } else {
      manualBox.hidden = true;
    }
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
    runSearch(nameInput.value.trim(), null);
  });

  // --- Form 2: URL ---
  formLink.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!urlInput.checkValidity()) {
      if (!CSS.supports('selector(:user-invalid)')) urlInput.classList.add('user-invalid-fallback');
      syncAriaValidation(urlInput);
      urlInput.focus();
      return;
    }

    urlPreviewBox.hidden = false;
    urlPreviewBox.textContent = 'Se analizează link-ul și se extrage produsul...';

    try {
      const resp = await fetch('/api/analyze-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: urlInput.value.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'Nu am putut analiza link-ul.');

      urlPreviewBox.innerHTML = '';
      if (data.image) {
        const img = document.createElement('img');
        img.src = data.image;
        img.alt = data.title;
        urlPreviewBox.append(img);
      }
      const info = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = data.title;
      const meta = document.createElement('p');
      meta.className = 'muted';
      meta.textContent = `Sursă: ${data.domain}${data.price ? ` • Preț găsit: ${formatLei(data.price)}` : ''}`;
      info.append(strong, meta);
      urlPreviewBox.append(info);

      if (categorySelect.value === 'auto' && data.detectedCategory) {
        categorySelect.value = data.detectedCategory;
        updateSizeSelector(data.detectedCategory);
      }

      runSearch(data.title, data.price || null);
    } catch (err) {
      urlPreviewBox.textContent = err.message;
    }
  });

  // --- Form 3: Photo Upload / Paste / Optional Gemini Vision ---
  function cleanFilenameToQuery(filename) {
    return filename
      .replace(/\.[a-z0-9]{2,5}$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\b(img|image|screenshot|photo|whatsapp|dsc|pxl)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function identifyWithGemini(file, apiKey) {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: 'Identifică produsul exact din această imagine (brand, model, tip) pentru a-l căuta pe site-uri de shopping din România. Răspunde DOAR cu un JSON valid de forma {"query":"Nume Produs","category":"shoes|clothes|electronics|general"} fără alt text.',
              },
              { inline_data: { mime_type: file.type || 'image/jpeg', data: base64 } },
            ],
          }],
        }),
      }
    );
    if (!resp.ok) throw new Error('Gemini API error');
    const json = await resp.json();
    const rawText = json.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  }

  async function handleImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;

    const objectUrl = URL.createObjectURL(file);
    photoPreviewImg.src = objectUrl;
    photoFileName.textContent = file.name || 'Imagine lipită din clipboard';
    dropzoneEmpty.hidden = true;
    dropzonePreview.hidden = false;

    const guessed = cleanFilenameToQuery(file.name || '');
    if (guessed.length >= 2) {
      photoQueryInput.value = guessed;
    }

    const apiKey = localStorage.getItem(GEMINI_KEY_STORAGE);
    if (apiKey) {
      photoAiStatus.textContent = '✨ Se identifică produsul cu Gemini Vision...';
      try {
        const result = await identifyWithGemini(file, apiKey);
        if (result.query) {
          photoQueryInput.value = result.query;
          photoAiStatus.textContent = `✨ Identificat automat: ${result.query}`;
        }
        if (result.category && categorySelect.value === 'auto') {
          categorySelect.value = result.category;
          updateSizeSelector(result.category);
        }
      } catch {
        photoAiStatus.textContent = 'Poți scrie sau confirma numele produsului mai jos.';
      }
    } else {
      photoAiStatus.textContent = 'Poți confirma numele produsului mai jos (sau adaugă o cheie Gemini în Setări AI pentru detecție automată).';
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
    runSearch(photoQueryInput.value.trim(), null);
  });

  // --- Settings Modal ---
  openSettingsBtn.addEventListener('click', () => {
    serperKeyInput.value = localStorage.getItem(SERPER_KEY_STORAGE) || '';
    geminiKeyInput.value = localStorage.getItem(GEMINI_KEY_STORAGE) || '';
    settingsDialog.showModal();
  });

  saveKeyBtn.addEventListener('click', () => {
    const serperVal = serperKeyInput.value.trim();
    const geminiVal = geminiKeyInput.value.trim();
    if (serperVal) localStorage.setItem(SERPER_KEY_STORAGE, serperVal);
    else localStorage.removeItem(SERPER_KEY_STORAGE);
    if (geminiVal) localStorage.setItem(GEMINI_KEY_STORAGE, geminiVal);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
    settingsDialog.close();
  });

  clearKeyBtn.addEventListener('click', () => {
    localStorage.removeItem(SERPER_KEY_STORAGE);
    localStorage.removeItem(GEMINI_KEY_STORAGE);
    serperKeyInput.value = '';
    geminiKeyInput.value = '';
    settingsDialog.close();
  });
})();
