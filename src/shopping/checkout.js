// Courses V0.3 — préparation pure d'un lot d'achats.
// Les écritures réelles restent les commandes purchase / purchaseFree déjà
// acceptées par le journal familial. Ce module ne contacte pas Firestore,
// n'efface aucune intention et ne modifie pas les règles.
import {rows} from '../family/domain.js';

const SCALE = 1000000;
const OP = /^[\w:-]{8,160}$/;

export function listCourses(cache) {
  return rows(cache).filter(row => row.totalMicros > 0 || row.review || row.sources.length);
}

export function stepMicros(unit) {
  return /^(kg|l|litre|litres|liter)$/i.test(String(unit || '').trim()) ? SCALE / 10 : SCALE;
}

function quantityOk(n) {
  return Number.isSafeInteger(n) && n > 0 && n <= 1e12;
}

// Aperçu aligné sur security/src/family-writer-core.mjs :
// le stock suit la quantité achetée ; la ligne baisse de min(acheté, prévu).
export function previewLine(row, purchasedMicros) {
  const bought = quantityOk(purchasedMicros) ? purchasedMicros : 0;
  const applied = Math.min(bought, row.totalMicros || 0);
  const tracked = !!row.productId && !!row.product && !row.product.deleted;
  const stockBefore = tracked ? row.product.stockMicros : null;
  const stockAfter = tracked ? stockBefore + bought : null;
  const remaining = (row.group || !tracked) ? Math.max(0, (row.totalMicros || 0) - applied) : Math.max(0, (row.product.targetMicros || 0) - stockAfter);
  return {bought, applied, stockBefore, stockAfter, remaining, tracked, oneOff: !tracked};
}

export function planCheckout(uid, courseRows, picks, operationIds = {}) {
  if (typeof uid !== 'string' || !uid) return {error: 'identity', chosen: [], commands: []};
  const chosen = [];
  for (const row of courseRows) {
    const pick = picks?.[row.id];
    if (!pick?.selected) continue;
    if (row.review || row.missing) return {error: 'review', chosen: [], commands: []};
    if (!quantityOk(pick.micros)) return {error: 'quantity', chosen: [], commands: []};
    const operationId = operationIds[row.id] || crypto.randomUUID();
    if (!OP.test(operationId)) return {error: 'identity', chosen: [], commands: []};
    const tracked = !!row.productId;
    chosen.push({
      rowId: row.id,
      operationId,
      purchasedMicros: pick.micros,
      productRevision: row.product?.revision || 0,
      groupRevision: row.group?.revision || 0,
      totalMicros: row.totalMicros,
      name: row.name,
      unit: row.unit,
      productId: tracked ? row.productId : null,
      tracked,
    });
  }
  if (!chosen.length) return {error: 'empty', chosen: [], commands: []};
  return {error: null, chosen, commands: chosen.map(item => commandFor(uid, item))};
}

export function commandFor(uid, item) {
  const tracked = item.tracked;
  return {
    actorUid: uid,
    operationId: item.operationId,
    confirmed: true,
    targetCollection: tracked ? 'products' : 'shoppingLines',
    targetId: tracked ? item.productId : item.rowId,
    expectedRevision: tracked ? item.productRevision : item.groupRevision,
    expectedGroupRevision: item.groupRevision || 0,
    action: tracked ? 'purchase' : 'purchaseFree',
    valueMicros: item.purchasedMicros,
    choice: 'unchanged',
  };
}

// Refuse le lot si la liste ou le stock a changé depuis l'aperçu.
// Ne produit aucune commande de compensation et n'abandonne rien.
export function guardCheckout(courseRows, chosen) {
  if (!chosen?.length) return 'empty';
  for (const item of chosen) {
    const row = courseRows.find(candidate => candidate.id === item.rowId);
    if (!row || row.review || row.missing) return 'conflict';
    if ((row.product?.revision || 0) !== item.productRevision) return 'conflict';
    if ((row.group?.revision || 0) !== item.groupRevision) return 'conflict';
    if (row.totalMicros !== item.totalMicros) return 'conflict';
    if ((row.productId || null) !== item.productId) return 'conflict';
  }
  return null;
}

// Miroir local du journal, réservé aux tests. La production passe par engine.submit.
export function applyMirrored(cache, command, journal = new Set()) {
  if (journal.has(command.operationId)) return {replayed: true, cache};
  const next = structuredClone(cache);
  const tracked = command.action === 'purchase';
  const product = tracked ? next.products.find(item => item.id === command.targetId) : null;
  const groupId = tracked ? 'product_' + command.targetId : command.targetId;
  const group = next.groups.find(item => item.id === groupId);
  if (tracked) {
    if (!product || product.revision !== command.expectedRevision) return {replayed: false, conflict: true, cache};
    if ((group?.revision || 0) !== (command.expectedGroupRevision || 0)) return {replayed: false, conflict: true, cache};
    product.stockMicros += command.valueMicros;
    product.revision += 1;
  } else if (!group || group.revision !== command.expectedRevision) {
    return {replayed: false, conflict: true, cache};
  }
  if (group) {
    const applied = Math.min(command.valueMicros, group.totalMicros || 0);
    group.totalMicros -= applied;
    group.revision += 1;
    if (tracked) group.productRevision = product.revision;
  }
  journal.add(command.operationId);
  return {replayed: false, conflict: false, cache: next, journal};
}
