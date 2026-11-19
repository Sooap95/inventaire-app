// Catalogue familial local et décisions de scan. Aucune écriture Firestore.
// Les fiches confirmées restent prioritaires sur les réponses externes.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ScanCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'inventaire-family-catalog-v1';
  const MAX = 400;

  function validBarcode(code) {
    if (!/^(?:\d{8}|\d{12}|\d{13})$/.test(code)) return false;
    let sum = 0;
    for (let i = code.length - 2, n = 0; i >= 0; i--, n++) sum += Number(code[i]) * (n % 2 ? 1 : 3);
    return (10 - sum % 10) % 10 === Number(code.at(-1));
  }

  function barcodeAliases(code) {
    return code.length === 12 ? [code, '0' + code] : code.length === 13 && code[0] === '0' ? [code, code.slice(1)] : [code];
  }

  function formatQty(value) {
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    if (!Number.isFinite(n) || n < 0) return null;
    const scaled = Math.round(n * 1e6) / 1e6;
    if (scaled > 1000000) return null;
    const text = scaled.toFixed(6).replace(/\.?0+$/, '');
    return /^\d+(?:\.\d{1,6})?$/.test(text) ? text : null;
  }

  function parseQty(value) {
    const text = String(value ?? '').trim().replace(',', '.');
    if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return null;
    return formatQty(text);
  }

  function stepQty(value, delta) {
    const current = Number(formatQty(value) || 0);
    return formatQty(Math.max(0, current + delta));
  }

  function sameQty(a, b) {
    return formatQty(a) === formatQty(b);
  }

  // Plusieurs images sans code sont nécessaires avant d'oublier le produit :
  // une image ratée ne doit pas rouvrir tout de suite la même fenêtre.
  function noteFrame(code, state) {
    const text = String(code || '');
    const hold = state?.hold || '';
    if (text && hold && barcodeAliases(text).includes(hold)) return { action: 'ignore', hold, misses: 0 };
    if (text) return { action: 'open', hold: text, misses: 0 };
    const misses = (state?.misses || 0) + 1;
    if (hold && misses < 8) return { action: 'wait', hold, misses };
    return { action: 'clear', hold: '', misses: 0 };
  }

  function read(storage) {
    try {
      const data = JSON.parse(storage.getItem(KEY) || '{}');
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  function write(storage, catalog) {
    const entries = Object.entries(catalog).slice(-MAX);
    storage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  }

  function rememberActive(storage, products) {
    const catalog = read(storage);
    const seen = new Set();
    for (const product of products || []) {
      const code = String(product.barcode || '').trim();
      if (!validBarcode(code)) continue;
      seen.add(code);
      const prev = catalog[code] || {};
      catalog[code] = {
        barcode: code,
        name: String(product.name || prev.name || ''),
        brand: prev.brand || '',
        category: product.category || prev.category || '',
        aisle: product.aisle || prev.aisle || '',
        unit: product.unit || prev.unit || 'pcs',
        notes: product.notes || prev.notes || '',
        image: prev.image || '',
        source: prev.source || 'famille',
        manual: true,
        active: true,
        productId: product.id || ''
      };
    }
    for (const [code, entry] of Object.entries(catalog)) {
      if (!seen.has(code)) entry.active = false;
    }
    write(storage, catalog);
    return catalog;
  }

  function rememberConfirmed(storage, entry) {
    const code = String(entry?.barcode || '').trim();
    if (!validBarcode(code) || !String(entry.name || '').trim()) return read(storage);
    const catalog = read(storage);
    const prev = catalog[code] || {};
    catalog[code] = {
      barcode: code,
      name: String(entry.name).trim(),
      brand: entry.brand || prev.brand || '',
      category: entry.category || '',
      aisle: entry.aisle || '',
      unit: entry.unit || 'pcs',
      notes: entry.notes || '',
      image: entry.image || prev.image || '',
      source: 'famille',
      manual: true,
      active: true,
      productId: entry.productId || prev.productId || ''
    };
    write(storage, catalog);
    return catalog;
  }

  function rememberImage(storage, code, image, source) {
    if (!validBarcode(String(code || '')) || !image) return read(storage);
    const catalog = read(storage);
    const key = barcodeAliases(code).find(alias => catalog[alias]) || code;
    const prev = catalog[key] || { barcode: key, name: '', manual: false, active: false, source: source || '' };
    if (prev.image) return catalog;
    catalog[key] = { ...prev, barcode: key, image, source: prev.source || source || '' };
    write(storage, catalog);
    return catalog;
  }

  function lookup(storage, code) {
    const catalog = read(storage);
    return barcodeAliases(String(code || '').trim()).map(alias => catalog[alias]).find(Boolean) || null;
  }

  function decide(products, catalogEntry, code) {
    const aliases = barcodeAliases(String(code || '').trim());
    const active = (products || []).filter(product => aliases.includes(String(product.barcode || '').trim()));
    if (active.length) return { type: 'adjust', products: active, catalog: catalogEntry || null };
    if (catalogEntry && catalogEntry.manual && catalogEntry.name) return { type: 'reintroduce', products: [], catalog: catalogEntry };
    return { type: 'create', products: [], catalog: null };
  }

  // Une fiche familiale confirmée n'est jamais remplacée par une réponse externe.
  function mergeExternal(family, external) {
    const base = family && family.manual ? { ...family } : {};
    const incoming = external || {};
    const pick = (key) => (base[key] ? base[key] : incoming[key] || '');
    return {
      name: pick('name'),
      brand: pick('brand'),
      category: pick('category'),
      aisle: pick('aisle'),
      unit: base.unit || incoming.unit || '',
      notes: base.notes || '',
      image: base.image || incoming.image || '',
      source: base.manual ? 'famille' : (incoming.source || ''),
      manual: !!base.manual
    };
  }

  return {
    validBarcode, barcodeAliases, formatQty, parseQty, stepQty, sameQty, noteFrame,
    rememberActive, rememberConfirmed, rememberImage, lookup, decide, mergeExternal, KEY
  };
});
