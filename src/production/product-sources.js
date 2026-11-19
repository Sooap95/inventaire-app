// Identification externe par code-barres exact.
// Open Food Facts, puis Open Beauty Facts, Open Products Facts et Open Pet Food Facts.
// Coop et Migros ne sont pas appelés : voir docs/SOURCES-SUISSES.md.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.ProductSources = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CACHE_KEY = 'inventaire-off-cache-v1';
  const HOSTS = {
    food: 'https://world.openfoodfacts.org',
    beauty: 'https://world.openbeautyfacts.org',
    product: 'https://world.openproductsfacts.org',
    pet: 'https://world.openpetfoodfacts.org'
  };
  const IMAGE_HOSTS = new Set([
    'images.openfoodfacts.org', 'images.openbeautyfacts.org', 'images.openproductsfacts.org', 'images.openpetfoodfacts.org',
    'static.openfoodfacts.org', 'static.openbeautyfacts.org', 'static.openproductsfacts.org', 'static.openpetfoodfacts.org'
  ]);
  const FIELDS = 'product_name,product_name_fr,product_name_de,brands,categories_tags,quantity,selected_images,image_front_small_url,image_front_thumb_url,image_front_url';
  const POSITIVE_MS = 14 * 86400000;
  const NEGATIVE_MS = 12 * 3600000;

  function kindFromVerbose(text) {
    const value = String(text || '').toLowerCase();
    if (/type:\s*beauty/.test(value)) return 'beauty';
    if (/pet/.test(value)) return 'pet';
    if (/type:\s*product/.test(value)) return 'product';
    return '';
  }

  function allowedImage(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && IMAGE_HOSTS.has(parsed.hostname);
    } catch {
      return false;
    }
  }

  function firstUrl(value) {
    if (!value || typeof value !== 'object') return '';
    for (const lang of ['fr', 'de', 'en']) {
      if (typeof value[lang] === 'string' && allowedImage(value[lang])) return value[lang];
    }
    return '';
  }

  function imagesFrom(product) {
    const selected = product?.selected_images?.front || {};
    const thumb = firstUrl(selected.small) || firstUrl(selected.thumb)
      || [product?.image_front_small_url, product?.image_front_thumb_url].find(allowedImage) || '';
    const full = firstUrl(selected.display) || [product?.image_front_url, product?.image_front_small_url].find(allowedImage) || thumb;
    return { thumb, full };
  }

  function normalize(product, source) {
    if (!product) return null;
    const images = imagesFrom(product);
    return {
      source,
      name: '',
      brand: String(product.brands || '').split(',')[0].trim(),
      categories_tags: Array.isArray(product.categories_tags) ? product.categories_tags : [],
      image: images.thumb,
      imageFull: images.full,
      product
    };
  }

  function named(product, source, lang) {
    const item = normalize(product, source);
    if (!item) return null;
    const raw = product;
    item.name = (lang === 'de' ? raw.product_name_de : raw.product_name_fr) || raw.product_name || raw.brands || '';
    return item;
  }

  function readCache(storage) {
    try {
      const data = JSON.parse(storage.getItem(CACHE_KEY) || '[]');
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function cached(storage, code, now) {
    const hit = readCache(storage).find(entry => entry.code === code);
    if (!hit) return undefined;
    const max = hit.item ? POSITIVE_MS : NEGATIVE_MS;
    if (now - hit.at > max) return undefined;
    return hit.item;
  }

  function store(storage, code, item, now) {
    const next = readCache(storage).filter(entry => entry.code !== code);
    next.push({ code, at: now, item });
    storage.setItem(CACHE_KEY, JSON.stringify(next.slice(-200)));
  }

  async function fetchKind(kind, code, signal) {
    const response = await fetch(HOSTS[kind] + '/api/v2/product/' + encodeURIComponent(code) + '.json?fields=' + FIELDS, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    });
    if (!response.ok && response.status !== 404) throw new Error('OFF_UNAVAILABLE');
    return response.json();
  }

  async function lookup(code, lang, options = {}) {
    const storage = options.storage;
    const now = options.now || Date.now();
    if (storage) {
      const hit = cached(storage, code, now);
      if (hit !== undefined) return hit;
    }
    const signal = options.signal || AbortSignal.timeout(10000);
    const food = await fetchKind('food', code, signal);
    let item = null;
    if (food?.status === 1 && food.product) item = named(food.product, 'Open Food Facts', lang);
    else {
      const hinted = kindFromVerbose(food?.status_verbose);
      const kinds = hinted ? [hinted] : ['beauty', 'product', 'pet'];
      for (const kind of kinds) {
        if (signal.aborted) break;
        try {
          const data = await fetchKind(kind, code, signal);
          if (data?.status === 1 && data.product) {
            item = named(data.product, sourceLabel(kind), lang);
            break;
          }
        } catch (error) {
          if (error.name === 'AbortError' || error.name === 'TimeoutError') throw error;
        }
      }
    }
    if (storage) store(storage, code, item, now);
    return item;
  }

  function sourceLabel(kind) {
    return {
      food: 'Open Food Facts',
      beauty: 'Open Beauty Facts',
      product: 'Open Products Facts',
      pet: 'Open Pet Food Facts'
    }[kind] || 'Open Food Facts';
  }

  return { kindFromVerbose, allowedImage, imagesFrom, named, lookup, CACHE_KEY, IMAGE_HOSTS };
});
