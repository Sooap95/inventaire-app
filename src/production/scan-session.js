// Session de scan continue. Les quantités confirmées passent par FamilyApp.stockCorrection.
(function () {
  'use strict';
  const Scan = window.ScanCatalog;
  const bridge = window.ScanBridge;
  if (!Scan || !bridge) return;

  let scanSession = false;
  let confirmingStock = false;
  let pendingImage = '';
  let pendingSource = '';
  let editingQuick = false;
  let resumeGuard = false;

  const words = () => bridge.lang() === 'de' ? {
    known: 'Bereits bekanntes Produkt. Prüfe die Karte, um es wieder aufzunehmen.',
    several: 'Mehrere Produkte tragen diesen Code.',
    photo: 'Produktfoto',
    credit: 'Foto: ',
    hold: 'Menge antippen, um sie direkt zu schreiben.'
  } : {
    known: 'Produit déjà connu. Vérifie la fiche pour le remettre dans l’inventaire.',
    several: 'Plusieurs produits portent ce code.',
    photo: 'Photo du produit',
    credit: 'Photo : ',
    hold: 'Touche la quantité pour la saisir directement.'
  };

  function resumeScan() {
    if (!scanSession || resumeGuard || document.hidden) return;
    const modal = document.getElementById('scan-modal');
    if (!modal || typeof startBarcode !== 'function') return;
    resumeGuard = true;
    modal.classList.remove('hidden');
    void startBarcode();
    setTimeout(() => { resumeGuard = false; }, 0);
  }

  function creditText(url, source) {
    if (!url || !window.ProductSources?.allowedImage(url)) return '';
    if (source && source !== 'famille') return words().credit + source;
    let host = '';
    try { host = new URL(url).hostname; } catch { return ''; }
    const label = host.includes('openbeautyfacts') ? 'Open Beauty Facts'
      : host.includes('openproductsfacts') ? 'Open Products Facts'
      : host.includes('openpetfoodfacts') ? 'Open Pet Food Facts'
      : host.includes('openfoodfacts') ? 'Open Food Facts' : '';
    return label ? words().credit + label : '';
  }

  function showPhoto(img, url, label) {
    if (!img) return;
    if (!url || !window.ProductSources?.allowedImage(url)) {
      img.hidden = true;
      img.removeAttribute('src');
      return;
    }
    img.hidden = false;
    img.alt = label || words().photo;
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  }

  function setQuickPhoto(url, source) {
    showPhoto(document.getElementById('quick-photo'), url, words().photo);
    const credit = document.getElementById('quick-photo-credit');
    if (credit) credit.textContent = creditText(url, source);
  }

  function commitQty(keep) {
    if (!editingQuick) return;
    const input = document.querySelector('#quick-modal .quick-qty-input');
    if (keep && input) {
      const parsed = Scan.parseQty(input.value);
      if (parsed !== null) bridge.setQuickStock(Number(parsed));
    }
    editingQuick = false;
    input?.remove();
    const display = document.getElementById('quick-stock-display');
    if (display) display.hidden = false;
    displayQty();
  }

  function displayQty() {
    const el = document.getElementById('quick-stock-display');
    if (el) el.textContent = Scan.formatQty(bridge.quickStock()) || '0';
  }

  function bindQtyEditor() {
    const display = document.getElementById('quick-stock-display');
    if (!display || display.dataset.bound) return;
    display.dataset.bound = '1';
    display.title = words().hold;
    display.addEventListener('click', () => {
      if (editingQuick) return;
      editingQuick = true;
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.setAttribute('aria-label', words().hold);
      input.className = 'quick-qty-input';
      input.value = Scan.formatQty(bridge.quickStock()) || '0';
      display.hidden = true;
      display.after(input);
      input.focus();
      input.select();
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); commitQty(true); }
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); commitQty(false); }
      });
      input.addEventListener('blur', () => commitQty(true));
    });
  }

  window.quickAdjust = function (delta) {
    commitQty(true);
    const next = Scan.stepQty(bridge.quickStock(), delta);
    if (next !== null) bridge.setQuickStock(Number(next));
    displayQty();
  };

  window.cancelQuickUpdate = function () {
    commitQty(false);
    document.getElementById('quick-modal')?.classList.add('hidden');
    resumeScan();
  };

  function whenHidden(modal) {
    return new Promise(resolve => {
      if (!modal || modal.classList.contains('hidden')) return resolve();
      const observer = new MutationObserver(() => {
        if (modal.classList.contains('hidden')) { observer.disconnect(); resolve(); }
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function watchFamily(modal) {
    return new Promise(resolve => {
      let done = false;
      const finish = (value) => { if (done) return; done = true; observer.disconnect(); resolve(value); };
      const observer = new MutationObserver(() => {
        if (modal.classList.contains('hidden')) finish('ok');
        else if (modal.querySelector('[role="alert"]')) finish('error');
      });
      observer.observe(modal, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
      setTimeout(() => finish(modal.classList.contains('hidden') ? 'ok' : 'timeout'), 20000);
    });
  }

  function armFamily(modal) {
    modal?.classList.add('scan-submit');
    if (modal) modal.inert = true;
  }

  function disarmFamily(modal) {
    modal?.classList.remove('scan-submit');
    if (modal) modal.inert = false;
  }

  const originalSave = window.saveQuickUpdate;
  window.saveQuickUpdate = async function () {
    if (!window.FAMILY_LAB_CONFIG) return originalSave();
    commitQty(true);
    if (confirmingStock || !bridge.quickId()) return;
    const product = bridge.products().find(item => item.id === bridge.quickId());
    if (!product) return cancelQuickUpdate();
    if (Scan.sameQty(bridge.quickStock(), product.stock)) return cancelQuickUpdate();
    confirmingStock = true;
    const modal = document.getElementById('family-modal');
    let quickHidden = false;
    try {
      await window.FamilyApp.stockCorrection(bridge.quickId(), Scan.formatQty(bridge.quickStock()), bridge.quickRevision());
      const button = document.getElementById('family-confirm');
      if (!button || !modal) throw new Error('confirm-unavailable');
      document.getElementById('quick-modal')?.classList.add('hidden');
      quickHidden = true;
      armFamily(modal);
      const settled = watchFamily(modal);
      button.click();
      const result = await settled;
      disarmFamily(modal);
      if (result === 'ok') resumeScan();
      else if (modal) whenHidden(modal).then(() => resumeScan());
    } catch (error) {
      disarmFamily(modal);
      window.FamilyApp?.reportError(error);
      const familyOpen = modal && !modal.classList.contains('hidden');
      if (quickHidden && !familyOpen) resumeScan();
    } finally {
      confirmingStock = false;
    }
  };

  function applyEmptyPhoto() {
    showPhoto(document.getElementById('product-photo'), '', '');
    const credit = document.getElementById('product-photo-credit');
    if (credit) credit.textContent = '';
  }

  function fillCreateForm(suggestion, reintroduce) {
    const setIfEmpty = (id, value) => {
      const field = document.getElementById(id);
      if (field && value && !String(field.value || '').trim()) field.value = value;
    };
    if (suggestion?.name) setIfEmpty('f-name', suggestion.name);
    if (suggestion?.brand && !document.getElementById('f-notes').value.trim()) setIfEmpty('f-notes', suggestion.brand);
    if (suggestion?.notes) setIfEmpty('f-notes', suggestion.notes);
    if (suggestion?.unit) document.getElementById('f-unit').value = suggestion.unit;
    if (suggestion?.aisle && !document.getElementById('f-aisle').value) document.getElementById('f-aisle').value = suggestion.aisle;
    if (suggestion?.category) document.getElementById('f-cat').value = suggestion.category;
    pendingImage = suggestion?.image || '';
    pendingSource = suggestion?.source || '';
    showPhoto(document.getElementById('product-photo'), pendingImage, suggestion?.name || words().photo);
    const credit = document.getElementById('product-photo-credit');
    if (credit) credit.textContent = creditText(pendingImage, pendingSource);
    if (reintroduce) setOffBanner(words().known, 'ok');
    else if (suggestion?.source) { setOffBanner(suggestion.source, 'ok'); showOffCredit(); }
    else setOffBanner('', '');
  }

  async function openCreate(code, catalogEntry) {
    bridge.setHold(code);
    document.getElementById('scan-modal')?.classList.add('hidden');
    void stopScanIfRunning();
    openAddModal();
    document.getElementById('f-barcode').value = code || '';
    const categoryAtOpen = document.getElementById('f-cat').value;
    const unitAtOpen = document.getElementById('f-unit').value;
    if (catalogEntry) {
      fillCreateForm(catalogEntry, true);
      return;
    }
    applyEmptyPhoto();
    if (!navigator.onLine || !window.FamilyApp?.externalLookup() || !window.ProductSources) return;
    const spinner = document.getElementById('off-spinner');
    spinner?.classList.add('show');
    try {
      const found = await window.ProductSources.lookup(code, bridge.lang(), { storage: bridge.storage() });
      if (document.getElementById('f-barcode').value.trim() !== code || document.getElementById('product-modal').classList.contains('hidden')) return;
      if (!found) { setOffBanner(t('off_not_found'), 'warn'); return; }
      const aisle = typeof guessAisle === 'function' ? guessAisle(found.categories_tags) : '';
      const category = typeof guessCategory === 'function' ? guessCategory(found.categories_tags) : '';
      if (document.getElementById('f-cat').value !== categoryAtOpen) found.category = '';
      else found.category = category;
      if (document.getElementById('f-unit').value !== unitAtOpen) found.unit = '';
      fillCreateForm({
        name: found.name,
        brand: found.brand,
        aisle,
        category: found.category,
        unit: found.unit,
        image: found.imageFull || found.image,
        source: found.source
      }, false);
    } catch {
      if (!document.getElementById('product-modal').classList.contains('hidden')) setOffBanner(t('off_unavailable'), 'warn');
    } finally {
      spinner?.classList.remove('show');
    }
  }

  function openAdjust(matches, code) {
    bridge.setHold(code);
    commitQty(false);
    const product = matches[0];
    openQuickModal(product.id);
    const catalogEntry = Scan.lookup(bridge.storage(), code);
    setQuickPhoto(catalogEntry?.image || '', catalogEntry?.source || '');
    if (!catalogEntry?.image && navigator.onLine && window.FamilyApp?.externalLookup() && window.ProductSources) {
      window.ProductSources.lookup(code, bridge.lang(), { storage: bridge.storage() }).then(found => {
        const image = found?.image || '';
        if (!image) return;
        try { Scan.rememberImage(bridge.storage(), code, image, found.source); } catch { return; }
        if (!document.getElementById('quick-modal')?.classList.contains('hidden') && bridge.holdMatches?.(code) !== false) setQuickPhoto(image, found.source);
        window.renderInventory?.();
      }).catch(() => {});
    }
    displayQty();
    const pick = document.getElementById('quick-pick');
    const note = document.getElementById('quick-note');
    if (note) note.textContent = matches.length > 1 ? words().several : '';
    if (pick) {
      pick.hidden = matches.length < 2;
      pick.replaceChildren();
      for (const item of matches) {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.name;
        pick.append(option);
      }
      if (matches.length > 1) {
        pick.value = product.id;
        pick.onchange = () => {
          const chosen = pick.value;
          commitQty(false);
          openQuickModal(chosen);
          displayQty();
          setQuickPhoto(catalogEntry?.image || '', catalogEntry?.source || '');
          pick.hidden = false;
          pick.value = chosen;
        };
      }
    }
  }

  window.handleScanResult = function (value, manual = false) {
    if (!barcodeAllowed() || (!manual && bridge.barcodeAccepted())) return;
    const code = String(value).trim();
    if (!Scan.validBarcode(code)) {
      if (manual) document.getElementById('scan-hint').textContent = barcodeWords().invalid;
      return;
    }
    bridge.setBarcodeAccepted(true);
    bridge.setHold(code);
    const input = document.getElementById('barcode-manual-code');
    if (input) input.value = code;
    const catalogEntry = Scan.lookup(bridge.storage(), code);
    const decision = Scan.decide(bridge.products(), catalogEntry, code);
    const result = document.getElementById('barcode-result');
    if (result) {
      const label = decision.type === 'adjust'
        ? barcodeWords().found + decision.products.map(item => item.name).join(', ')
        : decision.type === 'reintroduce' ? catalogEntry.name : barcodeWords().unknown;
      result.textContent = barcodeWords().code + ' : ' + code + ' — ' + label;
    }
    void stopScanIfRunning();
    if (decision.type === 'adjust') openAdjust(decision.products, code);
    else openCreate(code, decision.type === 'reintroduce' ? catalogEntry : null);
  };

  const originalOpen = window.openScanner;
  window.openScanner = function () {
    scanSession = true;
    bridge.setHold('');
    return originalOpen();
  };

  const originalClose = window.closeScanner;
  window.closeScanner = function () {
    scanSession = false;
    bridge.setHold('');
    pendingImage = '';
    return originalClose();
  };

  const originalCloseModal = window.closeModal;
  window.closeModal = function () {
    const open = !document.getElementById('product-modal').classList.contains('hidden');
    originalCloseModal();
    applyEmptyPhoto();
    if (open) resumeScan();
  };

  const originalCloseProduct = window.familyHost.closeProduct;
  window.familyHost.closeProduct = function () {
    const code = document.getElementById('f-barcode')?.value.trim();
    const photo = document.getElementById('product-photo');
    const photoUrl = photo && !photo.hidden && window.ProductSources?.allowedImage(photo.src) ? photo.src : '';
    if (Scan.validBarcode(code || '')) {
      try { Scan.rememberConfirmed(bridge.storage(), {
        barcode: code,
        name: document.getElementById('f-name').value,
        category: document.getElementById('f-cat').value,
        aisle: document.getElementById('f-aisle').value,
        unit: document.getElementById('f-unit').value,
        notes: document.getElementById('f-notes').value.trim(),
        image: pendingImage || photoUrl
      }); } catch { /* La fiche familiale reste enregistrée même si le catalogue local est plein. */ }
    }
    pendingImage = '';
    return originalCloseProduct();
  };

  const originalReplace = window.familyHost.replace;
  window.familyHost.replace = function (list) {
    const result = originalReplace(list);
    try { Scan.rememberActive(bridge.storage(), list); } catch { /* Le catalogue local est un aide, pas le stock. */ }
    return result;
  };

  function decorate() {
    for (const card of document.querySelectorAll('.product-card[data-id]')) {
      const product = bridge.products().find(item => item.id === card.dataset.id);
      const entry = product ? Scan.lookup(bridge.storage(), String(product.barcode || '').trim()) : null;
      const url = entry?.image || '';
      if (!url || !window.ProductSources?.allowedImage(url)) continue;
      const picture = card.querySelector('.product-picture');
      if (picture && !picture.querySelector('img')) {
        const fallback = picture.textContent;
        const img = document.createElement('img');
        img.alt = '';
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = url;
        img.onerror = () => { img.remove(); picture.textContent = fallback; };
        picture.textContent = '';
        picture.append(img);
      }
      const expanded = card.querySelector('.product-expanded');
      if (expanded && !expanded.querySelector('.product-detail-photo')) {
        const img = document.createElement('img');
        img.className = 'product-detail-photo';
        img.alt = product.name || words().photo;
        img.loading = 'lazy';
        img.referrerPolicy = 'no-referrer';
        img.src = url;
        const credit = document.createElement('p');
        credit.className = 'photo-credit';
        credit.textContent = creditText(url, entry?.source);
        img.onerror = () => { img.remove(); credit.remove(); };
        expanded.prepend(img);
        if (credit.textContent) img.after(credit);
      }
    }
  }

  const originalRender = window.renderInventory;
  window.renderInventory = function () {
    const result = originalRender();
    decorate();
    return result;
  };

  window.scanOverlayDismissed = function (id) {
    if (id === 'quick-modal') commitQty(false);
    if (id === 'product-modal') { pendingImage = ''; pendingSource = ''; }
    if (id === 'quick-modal' || id === 'product-modal' || id === 'link-modal') resumeScan();
    else if (id === 'scan-modal') {
      scanSession = false;
      bridge.setHold('');
      void stopScanIfRunning();
    }
  };

  if (typeof window.offReset === 'function') {
    const originalOffReset = window.offReset;
    window.offReset = function () {
      pendingImage = '';
      pendingSource = '';
      applyEmptyPhoto();
      return originalOffReset();
    };
  }

  bindQtyEditor();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !scanSession) return;
    const blocking = ['quick-modal', 'product-modal', 'link-modal', 'family-modal'].some(id => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    });
    const scan = document.getElementById('scan-modal');
    if (!blocking && scan && !scan.classList.contains('hidden')) resumeScan();
  });
})();
