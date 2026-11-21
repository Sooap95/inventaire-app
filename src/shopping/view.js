import {active, automatic, project, emptyState, fail} from './domain.js';

// Une coche est un repère de liste, jamais une quantité achetée.
export function lineChecks(line, auto, legacyChecked = false, needsReview = false) {
  const contributions = line ? active(line) : [];
  const automaticChecked = !!auto?.present && (line?.autoCheck
    ? line.autoCheck.signature === auto.signature && line.autoCheck.checked
    : legacyChecked);
  const flags = [...(auto?.present ? [automaticChecked] : []), ...contributions.map(c => c.checked)];
  const all = flags.length > 0 && flags.every(Boolean);
  return {automaticChecked, checked: all && !needsReview,
    indeterminate: flags.some(Boolean) && (!all || needsReview)};
}

export function checkLine(state, lineId, auto, checked) {
  const next = structuredClone(state), line = next.lines.find(l => l.id === lineId);
  if (!line) fail('conflict');
  for (const c of active(line)) c.checked = !!checked;
  if (auto?.present) line.autoCheck = {signature: auto.signature, checked: !!checked};
  return next;
}

export function checkAutomatic(state, lineId, auto, checked) {
  const next = structuredClone(state), line = next.lines.find(l => l.id === lineId);
  if (!line || !auto?.present) fail('conflict');
  line.autoCheck = {signature: auto.signature, checked: !!checked};
  return next;
}

// Modèle partagé par le rendu, la copie et l'impression. Aucun recalcul additif
// des contributions ici : seule la projection des décisions approuvées est lue.
export function shoppingRows(state = emptyState(), products = [], options = {}) {
  const {now = Date.now(), autoChecks = [], aisleIndex = () => 0, productIds = null, doneIds = []} = options;
  const rows = [], mapped = new Set();
  function row(product, line) {
    const cs = line ? active(line) : [], auto = automatic(product, now);
    let view = null;
    if (cs.length) {
      try { view = project(line, products, now); }
      catch { view = {quantity: '?', needsReview: true}; }
    }
    const needsReview = !!(view?.needsReview || view?.missingProduct);
    const checks = lineChecks(line, auto, autoChecks.includes(product?.id), needsReview);
    return {product, line, name: product?.name || line.name,
      quantity: view?.quantity ?? auto?.quantity ?? '?',
      unit: cs.length ? line.unit : auto.unit,
      aisle: product?.aisle || line?.aisle || '', auto, view, needsReview, checks,
      manual: cs.length > 0, suggested: !!auto?.suggested && !cs.length && !doneIds.includes(product?.id),
      urgent: !!product && globalThis.InventoryStock.getStatus(product) === 'low'};
  }
  const selected = productIds ? productIds.map(id => products.find(p => p.id === id)).filter(Boolean) : products;
  for (const product of selected) {
    const line = state.lines.find(l => l.productId === product.id && (active(l).length || l.autoCheck));
    if (!productIds && !active(line || {contributions: []}).length && !automatic(product, now).present) continue;
    if (line) mapped.add(line.id);
    const item = row(product, line);
    if (doneIds.includes(product.id) && !item.manual) item.checks = {automaticChecked: true, checked: true, indeterminate: false};
    rows.push(item);
  }
  for (const line of state.lines) {
    if (active(line).length && !mapped.has(line.id)) rows.push(row(null, line));
  }
  return rows.sort((a, b) => Number(a.suggested) - Number(b.suggested)
    || aisleIndex(a.aisle) - aisleIndex(b.aisle)
    || Number(b.urgent) - Number(a.urgent) || a.name.localeCompare(b.name));
}

export const outputWords = language => language === 'de'
  ? {title: 'Einkaufsliste', review: 'Menge erneut prüfen', suggested: 'Vorausplanen (optional)', empty: 'Keine Artikel einzukaufen.'}
  : {title: 'Liste de courses', review: 'Quantité à revérifier', suggested: 'À anticiper (facultatif)', empty: 'Aucun article à acheter.'};

export function rowText(row, language = 'fr') {
  const words = outputWords(language);
  const mark = row.checks.checked ? '[x]' : row.checks.indeterminate ? '[-]' : '[ ]';
  return `${mark} ${row.name} ×${row.quantity} ${row.unit}${row.needsReview ? ' — ⚠ ' + words.review : ''}`;
}

export function shoppingText(rows, language = 'fr', aisleLabel = s => s) {
  const words = outputWords(language), text = [words.title];
  let last = null;
  for (const row of rows) {
    const group = `${Number(row.suggested)}:${row.aisle}`;
    if (group !== last) { text.push('', `${row.suggested ? words.suggested + ' · ' : ''}${aisleLabel(row.aisle)}`); last = group; }
    text.push(rowText(row, language));
  }
  if (!rows.length) text.push(words.empty);
  return text.join('\n');
}
