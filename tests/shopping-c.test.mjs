import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {emptyState, parseList, planBatch, project, automatic, removeContribution, toggleContribution, reviewTotal} from '../src/shopping/domain.js';
import {shoppingRows, shoppingText, rowText, lineChecks, checkLine, checkAutomatic} from '../src/shopping/view.js';
import {readBackup, planRestore, backupOperation, validateState, MAX_BACKUP_BYTES} from '../src/shopping/backup.js';
import {memoryStore} from '../src/shopping/store.js';

const products = [{id: 'milk', name: 'Lait', unit: 'L', stock: 1, threshold: 1, target: 3, aisle: 'Boissons'}];
const file = state => ({format: 'inventaire-shopping-local', version: 1, state: structuredClone(state)});
function add(state, text, choice, inventory = products) {
  const rows = parseList(text, inventory);
  const result = planBatch(state, inventory, rows, Object.fromEntries(rows.map(r => [r.id, choice])));
  assert.equal(result.error, null); return result.next;
}
const restore = (current, source, inventory = products) => planRestore(current, file(source), inventory);

test('C1 : copie des totaux 2/3/5 sans addition nouvelle et sans modifier l’inventaire', () => {
  const before = structuredClone(products);
  for (const [choice, total] of [['keep', '2'], ['set_total', '3'], ['add_extra', '5']]) {
    const state = add(emptyState(), 'lait x3', choice), rows = shoppingRows(state, products);
    assert.equal(rows.length, 1); assert.equal(rows[0].quantity, total);
    assert.ok(shoppingText(rows).includes(`Lait ×${total} L`));
  }
  assert.deepEqual(products, before);
});
test('C1 : articles libres et unités personnalisées conservés, copier inclut toutes les lignes', () => {
  const state = add(add(emptyState(), 'pommes 2 kg'), 'pain');
  const rows = shoppingRows(state, products), text = shoppingText(rows);
  assert.equal(rows.length, 3); assert.match(text, /pommes ×2 kg/); assert.match(text, /pain ×1 article/);
  assert.match(text, /Lait ×2 L/);
  const custom = parseList('ruban', []); custom[0].unit = 'rouleau spécial';
  assert.match(shoppingText(shoppingRows(planBatch(emptyState(), [], custom).next, [])), /rouleau spécial/);
});
test('C1 : total périmé signalé en FR/DE et dernière quantité approuvée conservée', () => {
  const state = add(emptyState(), 'lait x3', 'set_total');
  const inventory = [{...products[0], stock: 0}], rows = shoppingRows(state, inventory);
  assert.equal(rows[0].quantity, '3'); assert.equal(rows[0].needsReview, true);
  assert.match(shoppingText(rows), /Quantité à revérifier/);
  assert.match(shoppingText(rows, 'de'), /Einkaufsliste[\s\S]*Menge erneut prüfen/);
});
test('C1 : suggestions visibles incluses et snapshot du mode automatique respecté', () => {
  const inventory = [{...products[0], stock: 4, frequency: 'hebdomadaire', lastRestocked: '2020-01-01'}];
  const rows = shoppingRows(emptyState(), inventory, {now: Date.parse('2026-11-07')});
  assert.equal(rows[0].suggested, true); assert.match(shoppingText(rows), /facultatif/);
  const frozen = shoppingRows(emptyState(), [{...products[0], stock: 3}], {productIds: ['milk'], doneIds: ['milk']});
  assert.equal(frozen.length, 1); assert.equal(frozen[0].quantity, '0'); assert.match(rowText(frozen[0]), /^\[x\]/);
});
test('C2 : cocher seulement les contributions d’une ligne mixte donne un état partiel', () => {
  const state = add(emptyState(), 'lait x3', 'set_total'), line = state.lines[0];
  const next = toggleContribution(state, line.id, line.contributions[0].id, true);
  const checks = shoppingRows(next, products)[0].checks;
  assert.equal(checks.checked, false); assert.equal(checks.indeterminate, true); assert.equal(checks.automaticChecked, false);
  assert.match(shoppingText(shoppingRows(next, products)), /^Liste de courses[\s\S]*\[-\]/);
  assert.equal(products[0].stock, 1);
});
test('C2 : la case principale bascule toutes les sources, sans achat et avec états distincts', () => {
  const state = add(add(emptyState(), 'lait x3', 'add_extra'), 'lait x1', 'add_extra'), line = state.lines[0];
  const next = checkLine(state, line.id, automatic(products[0]), true), row = shoppingRows(next, products)[0];
  assert.equal(row.checks.checked, true); assert.equal(row.checks.indeterminate, false);
  assert.ok(next.lines[0].contributions.every(c => c.checked)); assert.equal(next.lines[0].autoCheck.checked, true);
  const one = toggleContribution(next, line.id, line.contributions[0].id, false);
  assert.equal(shoppingRows(one, products)[0].checks.indeterminate, true);
  assert.equal(one.lines[0].contributions[1].checked, true); assert.equal(one.lines[0].autoCheck.checked, true);
  const cleared = checkLine(one, line.id, automatic(products[0]), false);
  assert.ok(cleared.lines[0].contributions.every(c => !c.checked)); assert.equal(cleared.lines[0].autoCheck.checked, false);
  assert.equal(products[0].stock, 1);
});
test('C2 : coche automatique distincte, héritage historique, retrait et stock changé', () => {
  const state = add(emptyState(), 'lait x3', 'add_extra'), line = state.lines[0], auto = automatic(products[0]);
  assert.equal(lineChecks(line, auto, true).indeterminate, true);
  const checked = checkAutomatic(state, line.id, auto, true);
  assert.equal(checked.lines[0].contributions[0].checked, false);
  const removed = removeContribution(checked, line.id, line.contributions[0].id);
  assert.equal(shoppingRows(removed, products)[0].checks.checked, true);
  assert.equal(shoppingRows(removed, [{...products[0], stock: 0}])[0].checks.checked, false);
});
test('C2 : état libre agrégé, décision périmée jamais présentée comme terminée', () => {
  const state = add(emptyState(), 'pain'), line = state.lines[0];
  const checked = checkLine(state, line.id, null, true);
  assert.equal(shoppingRows(checked, [])[0].checks.checked, true);
  const mixed = add(emptyState(), 'lait x3', 'set_total');
  const all = checkLine(mixed, mixed.lines[0].id, automatic(products[0]), true);
  const row = shoppingRows(all, [{...products[0], stock: 0}])[0];
  assert.equal(row.needsReview, true); assert.equal(row.checks.checked, false); assert.equal(row.checks.indeterminate, true);
});
test('C3 : lecture du format existant et restauration exacte dans un panier vide', async () => {
  let source = add(add(emptyState(), 'lait x3', 'set_total'), 'pain');
  const store = memoryStore(); await store.commit(0, 'source-op', 'source-payload', source); source = await store.read();
  const decoded = readBackup(JSON.stringify(file(source))), plan = planRestore(emptyState(), decoded, products);
  assert.equal(plan.conflicts.length, 0); assert.equal(plan.added, 2);
  const target = memoryStore(); await target.commit(0, await backupOperation(decoded), 'restore', plan.next);
  const saved = await target.read(); assert.deepEqual(saved.lines, source.lines);
  assert.equal(saved.operations[0].id, 'source-op'); assert.equal(saved.operations.length, 2);
  assert.equal(shoppingRows(saved, products).find(r => r.name === 'Lait').quantity, '3');
});
test('C3 : données disjointes conservées, journal local et journal restauré tous deux préservés', async () => {
  const local = memoryStore(); await local.commit(0, 'local', 'local', add(emptyState(), 'pommes'));
  const source = memoryStore(); await source.commit(0, 'source', 'source', add(emptyState(), 'pain'));
  const before = await local.read(), incoming = await source.read(), plan = restore(before, incoming);
  assert.equal(plan.conflicts.length, 0);
  await local.commit(before.revision, 'restoration', 'restoration', plan.next);
  const saved = await local.read(); assert.deepEqual(saved.lines[0], before.lines[0]); assert.deepEqual(saved.lines[1], incoming.lines[0]);
  assert.deepEqual(saved.operations.map(o => o.id), ['local', 'source', 'restoration']);
});
test('C3 : import répété et relecture du même fichier, aucun doublon ni nouvelle quantité', async () => {
  const source = add(emptyState(), 'lait x3', 'add_extra'), decoded = file(source), op = await backupOperation(decoded);
  const store = memoryStore(), plan = planRestore(emptyState(), decoded, products);
  await store.commit(0, op, op, plan.next); const before = await store.read();
  const replay = await store.commit(0, op, op, plan.next); assert.equal(replay.replayed, true);
  const second = planRestore(await store.read(), readBackup(JSON.stringify(decoded)), products);
  assert.equal(second.changes, 0); assert.equal(second.items[0].kind, 'same'); assert.deepEqual(await store.read(), before);
  assert.equal(project(before.lines[0], products).quantity, '5');
  assert.equal(await backupOperation(JSON.parse(JSON.stringify(decoded, null, 2))), op);
});
test('C3 : conflit sur une ligne bloque aussi une ligne libre nouvelle, sans restauration partielle', () => {
  const original = add(emptyState(), 'lait x3', 'set_total'), changed = structuredClone(original);
  changed.lines[0].contributions[0].checked = true;
  const source = add(changed, 'pain'), before = structuredClone(original), plan = restore(original, source);
  assert.equal(plan.next, null); assert.equal(plan.items.find(i => i.name === 'Lait').kind, 'conflict');
  assert.deepEqual(original, before); assert.equal(original.lines.length, 1);
});
test('C3 : noms libres/produits et IDs de contributions en collision bloqués', () => {
  const free = add(emptyState(), 'Lait', undefined, []), known = add(emptyState(), 'lait x3', 'set_total');
  assert.equal(restore(free, known).next, null);
  const local = add(emptyState(), 'pommes'), source = add(emptyState(), 'pain');
  const id = local.lines[0].contributions[0].id, line = source.lines[0], c = line.contributions[0];
  c.id = id; line.decisions[0].sourceId = id;
  line.baseline.contributions = JSON.stringify([[id, c.revision, c.quantity, c.unit]]);
  assert.equal(restore(local, source).next, null);
});
test('C3 : conflit d’alias ou d’opération existante refusé sans écrasement', () => {
  const local = emptyState(), source = emptyState();
  local.aliases = [{name: 'atamil', productId: 'a'}]; source.aliases = [{name: 'atamil', productId: 'b'}];
  assert.equal(restore(local, source).conflicts[0].type, 'alias');
  local.aliases = []; source.aliases = []; local.operations = [{id: 'same', signature: 'a'}]; source.operations = [{id: 'same', signature: 'b'}];
  assert.equal(restore(local, source).conflicts[0].type, 'operation');
  assert.equal(local.operations[0].signature, 'a');
});
test('C3 : JSON incorrect, format inconnu, versions inconnues, fichier trop gros refusés', () => {
  for (const raw of ['{', 'null', '[]', '{}', JSON.stringify({...file(emptyState()), format: 'inventory'})]) {
    assert.throws(() => readBackup(raw), e => e.code === 'restore-format');
  }
  for (const f of [{...file(emptyState()), version: 2}, file({...emptyState(), formatVersion: 2})]) {
    assert.throws(() => readBackup(JSON.stringify(f)), e => e.code === 'restore-version');
  }
  assert.throws(() => readBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), e => e.code === 'restore-size');
});
test('C3 : structure, unités, références, identifiants et total approuvé incohérents refusés', () => {
  const state = add(emptyState(), 'lait x3', 'set_total');
  const invalid = [s => s.lines.push(structuredClone(s.lines[0])), s => s.lines[0].contributions[0].quantity = '-3',
    s => s.lines[0].contributions[0].checked = 'oui', s => s.lines[0].decisions[0].sourceId = 'absent',
    s => s.lines[0].decisions[0].quantity = '5', s => s.lines[0].unit = 'kg',
    s => s.lines[0].approvedQuantity = '300', s => s.lines[0].baseline.contributions = '[]',
    s => s.unknown = true];
  for (const change of invalid) { const copy = structuredClone(state); change(copy); assert.throws(() => readBackup(JSON.stringify(file(copy))), e => e.code === 'restore-format'); }
});
test('C3 : historique édité, supprimé et réexaminé reste exportable puis restaurable', () => {
  let source = add(add(emptyState(), 'lait x3', 'set_total'), 'lait x1', 'add_extra'), line = source.lines[0];
  const edited = parseList('lait x2', products); edited[0].editId = line.contributions[0].id;
  source = planBatch(source, products, edited, {[edited[0].id]: 'set_total'}).next;
  source = removeContribution(source, line.id, line.contributions[1].id);
  source = reviewTotal(source, products, line.id, '4');
  source = checkLine(source, line.id, automatic(products[0]), true);
  const decoded = readBackup(JSON.stringify(file(source))), plan = planRestore(emptyState(), decoded, products);
  assert.deepEqual(plan.next.lines, source.lines); assert.equal(plan.items[0].quantity, '4');
  assert.equal(shoppingRows(plan.next, products)[0].checks.checked, true);
  assert.ok(plan.next.lines[0].contributions.some(c => c.id === line.contributions[0].id && c.revision === 2));
});
test('C3 : sauvegarde avec boîtes et œufs individuels explicitement distincts restaurable', () => {
  const inventory = [...products, {id: 'eggs', name: 'Œufs', unit: 'boîtes', stock: 3, threshold: 1, target: 3}];
  const rows = parseList('12 œufs\nœufs x2', inventory); rows[0].productId = null; rows[0].distinctFree = true;
  const source = planBatch(emptyState(), inventory, rows).next;
  const plan = restore(emptyState(), source, inventory);
  assert.equal(plan.conflicts.length, 0); assert.equal(plan.added, 2);
  assert.deepEqual(plan.next.lines, source.lines);
});
test('C3 : total restauré avec stock changé signalé, aucun produit ni stock restauré', () => {
  const source = add(emptyState(), 'lait x3', 'set_total'), inventory = [{...products[0], stock: 0}], before = structuredClone(inventory);
  const plan = restore(emptyState(), source, inventory);
  assert.equal(plan.items[0].needsReview, true); assert.equal(plan.items[0].quantity, '3');
  assert.deepEqual(inventory, before);
});
test('C3 : concurrence pendant l’aperçu bloque la transaction complète', async () => {
  const store = memoryStore(), old = await store.read(), plan = restore(old, add(emptyState(), 'pain'));
  await store.commit(0, 'other-tab', 'other-tab', add(old, 'pommes'));
  await assert.rejects(store.commit(0, 'restore', 'restore', plan.next), e => e.code === 'conflict');
  assert.equal((await store.read()).lines.length, 1); assert.equal((await store.read()).lines[0].name, 'pommes');
});
test('C : le graphe de fichiers ajouté est couvert par le précache', () => {
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const path of ['view.js', 'backup.js', 'restore-ui.js']) assert.ok(sw.includes(`./src/shopping/${path}`));
});
