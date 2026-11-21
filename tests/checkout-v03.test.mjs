import assert from 'node:assert/strict';
import test from 'node:test';
import {listCourses, planCheckout, guardCheckout, previewLine, applyMirrored} from '../src/shopping/checkout.js';
import {enqueue, fresh} from '../src/family/state.js';

const SCALE = 1000000;
const UID = 'device-test-1';

function product(partial) {
  return {
    id: 'lait', name: 'Lait', unit: 'L', stockMicros: 2 * SCALE, thresholdMicros: 2 * SCALE,
    targetMicros: 5 * SCALE, frequency: '', lastRestocked: null, revision: 3, deleted: false,
    authorUid: UID, details: {}, legacy: {}, ...partial,
  };
}
function group(partial) {
  return {
    id: 'product_lait', productId: 'lait', name: 'Lait', unit: 'L', totalMicros: 5 * SCALE,
    automaticMicros: 3 * SCALE, productRevision: 3, needsReview: false, revision: 4,
    contributions: {extra: {id: 'extra', revision: 1, quantityMicros: 2 * SCALE, status: 'active', createdBy: UID}},
    checks: {extra: false}, checkAll: false, automaticChecked: false, fulfilledMicros: 0, ...partial,
  };
}
function cache(extra = {}) {
  const lait = product();
  return {
    products: [lait, product({id: 'beurre', name: 'Beurre', stockMicros: SCALE, thresholdMicros: 0, targetMicros: SCALE, revision: 1})],
    groups: [group(), group({
      id: 'free_papier', productId: null, name: 'Papier cadeau', unit: 'article', totalMicros: SCALE,
      automaticMicros: 0, productRevision: 0, revision: 2,
      contributions: {gift: {id: 'gift', revision: 1, quantityMicros: SCALE, status: 'active', createdBy: UID}},
      checks: {gift: false},
    })],
    ...extra,
  };
}

test('une seule liste réunit le besoin automatique, le supplément et le ponctuel', () => {
  const courses = listCourses(cache());
  const lait = courses.find(row => row.productId === 'lait');
  const papier = courses.find(row => row.id === 'free_papier');
  assert.equal(lait.automaticMicros, 3 * SCALE);
  assert.equal(lait.totalMicros, 5 * SCALE);
  assert.equal(papier.productId, null);
  assert.equal(courses.some(row => row.productId === 'beurre'), false);
});

test('achat partiel : stock 2 + acheté 4 = 6, reste 1, beurre inchangé', () => {
  const before = cache();
  const courses = listCourses(before);
  const lait = courses.find(row => row.productId === 'lait');
  const plan = planCheckout(UID, courses, {product_lait: {selected: true, micros: 4 * SCALE}, free_papier: {selected: true, micros: SCALE}});
  assert.equal(plan.error, null);
  assert.equal(plan.commands.length, 2);
  assert.deepEqual(previewLine(lait, 4 * SCALE), {bought: 4 * SCALE, applied: 4 * SCALE, stockBefore: 2 * SCALE, stockAfter: 6 * SCALE, remaining: SCALE, tracked: true, oneOff: false});
  const journal = new Set();
  let state = before;
  for (const command of plan.commands) {
    const applied = applyMirrored(state, command, journal);
    assert.equal(applied.conflict, false);
    state = applied.cache;
  }
  assert.equal(state.products.find(item => item.id === 'lait').stockMicros, 6 * SCALE);
  assert.equal(state.groups.find(item => item.id === 'product_lait').totalMicros, SCALE);
  assert.equal(state.groups.find(item => item.id === 'free_papier').totalMicros, 0);
  assert.equal(state.products.find(item => item.id === 'beurre').stockMicros, SCALE);
  assert.equal(state.products.some(item => item.name === 'Papier cadeau'), false);
});

test('la seconde confirmation du même lot ne compte pas deux fois', () => {
  const courses = listCourses(cache());
  const plan = planCheckout(UID, courses, {product_lait: {selected: true, micros: 4 * SCALE}});
  const journal = new Set();
  const first = applyMirrored(cache(), plan.commands[0], journal);
  const second = applyMirrored(first.cache, plan.commands[0], journal);
  assert.equal(second.replayed, true);
  assert.equal(second.cache.products.find(item => item.id === 'lait').stockMicros, 6 * SCALE);
  const again = planCheckout(UID, courses, {product_lait: {selected: true, micros: 4 * SCALE}}, {product_lait: plan.chosen[0].operationId});
  assert.equal(again.commands[0].operationId, plan.commands[0].operationId);
});

test('un conflit d’aperçu n’émet aucune commande', () => {
  const courses = listCourses(cache());
  const plan = planCheckout(UID, courses, {product_lait: {selected: true, micros: SCALE}});
  const moved = listCourses(cache());
  moved.find(row => row.id === 'product_lait').product.revision = 9;
  assert.equal(guardCheckout(moved, plan.chosen), 'conflict');
  assert.equal(plan.commands.length, 1);
});

test('les intentions déjà bloquées restent intactes', () => {
  let state = fresh(UID);
  state.cache.products = [{id: 'lait', revision: 3}];
  state.cache.groups = [{id: 'free_papier', revision: 2}];
  const stuck = ['purchaseFree', 'checkAll', 'checkAll', 'check'].map((action, index) => ({
    actorUid: UID, operationId: `stuck-op-${index + 10}`, confirmed: true,
    targetCollection: action === 'purchaseFree' ? 'shoppingLines' : 'shoppingLines',
    targetId: action === 'purchaseFree' ? 'free_papier' : 'product_lait',
    expectedRevision: action === 'purchaseFree' ? 2 : 4,
    action, valueMicros: action.startsWith('check') ? 0 : SCALE, choice: 'unchanged',
    expectedProductRevision: 3, productId: action === 'purchaseFree' ? null : 'lait', entryId: null,
  }));
  state = enqueue(state, stuck);
  for (const item of state.outbox) if (item.command.action !== 'purchaseFree') item.status = 'conflict';
  const courses = listCourses(cache());
  const plan = planCheckout(UID, courses, {product_lait: {selected: true, micros: SCALE}});
  const next = enqueue(state, plan.commands);
  assert.equal(next.outbox.length, 5);
  assert.deepEqual(next.outbox.slice(0, 4).map(item => [item.command.operationId, item.command.action, item.status]), [
    ['stuck-op-10', 'purchaseFree', 'pending'],
    ['stuck-op-11', 'checkAll', 'conflict'],
    ['stuck-op-12', 'checkAll', 'conflict'],
    ['stuck-op-13', 'check', 'conflict'],
  ]);
  assert.equal(next.cache.products[0].revision, 3);
});

test('hors ligne, le lot reste en attente sans changer le stock confirmé', () => {
  let state = fresh(UID);
  state.cache = cache();
  const plan = planCheckout(UID, listCourses(state.cache), {free_papier: {selected: true, micros: SCALE}});
  const queued = enqueue(state, plan.commands);
  assert.equal(queued.outbox[0].status, 'pending');
  assert.equal(queued.cache.groups.find(item => item.id === 'free_papier').totalMicros, SCALE);
  assert.equal(queued.cache.products.find(item => item.id === 'lait').stockMicros, 2 * SCALE);
});

test('les articles non cochés ne partent pas', () => {
  const plan = planCheckout(UID, listCourses(cache()), {free_papier: {selected: false, micros: SCALE}});
  assert.equal(plan.error, 'empty');
  assert.equal(plan.commands.length, 0);
});

test('une ligne à revérifier bloque le lot sans écriture', () => {
  const courses = listCourses(cache());
  courses.find(row => row.id === 'product_lait').review = true;
  const plan = planCheckout(UID, courses, {product_lait: {selected: true, micros: SCALE}});
  assert.equal(plan.error, 'review');
  assert.equal(plan.commands.length, 0);
});
