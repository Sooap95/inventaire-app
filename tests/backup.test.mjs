import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBackup,parseBackup,restorationPreview,restoreIntoSandbox,MAX_BYTES } from '../src/backup/backup.js';
const products = JSON.parse(readFileSync(new URL('./fixtures/products.json',import.meta.url),'utf8'));
const encode = JSON.stringify;

test('sauvegarde versionnée et restauration exacte en bac vide', async () => {
  const backup = await createBackup(products);
  assert.equal(backup.formatVersion,1);
  const parsed = await parseBackup(encode(backup));
  assert.deepEqual(restoreIntoSandbox([],parsed.products),products);
  parsed.products[0].stock = 999;
  assert.equal(products[0].stock,1);
});
test('export ancien accepté, sans inventer identifiant ni normaliser les champs', async () => {
  const parsed = await parseBackup(encode(products));
  assert.equal(parsed.legacy,true);
  assert.deepEqual(parsed.products,products);
  assert.equal(parsed.products[0].unknownLegacyField.preserve,true);
});
test('empreinte, comptage, version, collection inattendue et JSON tronqué refusés', async () => {
  for (const mutate of [b=>b.collections.products[0].stock++, b=>b.counts.products++, b=>b.formatVersion++, b=>b.collections.other=[]]) {
    const b = await createBackup(products); mutate(b);
    await assert.rejects(parseBackup(encode(b)));
  }
  await assert.rejects(parseBackup('{'));
  await assert.rejects(parseBackup(' '.repeat(MAX_BYTES+1)));
});
test('doublons, identifiants absents et quantités invalides refusés', async () => {
  for (const rows of [[products[0],products[0]],[{...products[0],id:undefined}],[{...products[0],stock:-1}],[{...products[0],target:'3'}]]) {
    await assert.rejects(createBackup(rows));
  }
});
test('restauration additive, idempotente et non destructive', () => {
  const base = [products[0]], incoming = [products[1]];
  const next = restoreIntoSandbox(base,incoming);
  assert.deepEqual(next,products);
  assert.deepEqual(base,[products[0]]);
  assert.deepEqual(restoreIntoSandbox(next,incoming),next);
  const conflict = [{...products[0],stock:20}];
  assert.deepEqual(restorationPreview(base,conflict).conflicts,[products[0].id]);
  assert.throws(()=>restoreIntoSandbox(base,conflict),/Conflit/);
  assert.equal(base[0].stock,1);
});
test('historique au-delà de 50 entrées et champs inconnus intégralement conservés', async () => {
  const rows = [{...products[0],restockHistory:Array.from({length:120},(_,i)=>({date:'2026-01-01',qty:i,by:'Fictif',extra:i}))}];
  assert.deepEqual((await parseBackup(encode(await createBackup(rows)))).products,rows);
});
