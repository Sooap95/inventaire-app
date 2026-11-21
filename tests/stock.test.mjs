import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import '../src/domain/stock.js';
const stock = globalThis.InventoryStock;
const now = Date.parse('2026-11-06T12:00:00Z');

// Oracle : fonctions réellement présentes à la révision auditée, sans exécuter
// l'application, ses scripts tiers ou sa configuration Firebase.
const original = readFileSync(new URL('./fixtures/stock-baseline.js',import.meta.url),'utf8');
const context = vm.createContext({ Date: class extends Date { static now() { return now; } } });
for (const name of ['getStatus','freqDays','isDepletingSoon','isSuggested']) {
  const match = original.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
  assert.ok(match, `Fonction historique ${name} trouvée`);
  vm.runInContext(match[0], context);
}

test('statuts : limites inclusives et calcul du besoin', () => {
  for (const [value, expected] of [[0,'low'],[2,'low'],[2.5,'medium'],[3,'medium'],[3.01,'ok']]) {
    assert.equal(stock.getStatus({stock:value,threshold:2}), expected);
  }
  assert.equal(stock.quantityNeeded({stock:1.5,target:4}), 2.5);
  assert.equal(stock.quantityNeeded({stock:5,target:4}), 0);
  assert.equal(stock.getStatus({stock:0,threshold:0}), 'low');
});
test('anticipation : sept jours stricts, dates invalides et stock OK', () => {
  const p = { stock:4,threshold:1,frequency:'hebdomadaire',lastRestocked:new Date(now).toISOString() };
  assert.equal(stock.isSuggested(p, now), false);
  assert.equal(stock.isSuggested(p, now + 1), true);
  assert.equal(stock.isSuggested({...p, stock:1}, now + 1), false);
  assert.equal(stock.isDepletingSoon({...p,lastRestocked:'invalide'}, now), false);
  assert.equal(stock.isDepletingSoon({...p,frequency:''}, now), false);
  assert.equal(stock.isDepletingSoon({...p,lastRestocked:'2020-01-01'}, now), true);
});
test('parité avec le code audité sur 3 000 combinaisons', () => {
  let count = 0;
  for (const quantity of [0,0.5,1,1.5,2,3,4,10,100,1000])
    for (const threshold of [0,0.5,1,2,3])
      for (const frequency of ['', 'quotidien','hebdomadaire','mensuel','trimestriel','inconnue'])
        for (const age of [-100,-7,0,1,6,7,8,30,90,100]) {
          const p = {stock:quantity, threshold, target:5, frequency,lastRestocked:new Date(now-age*86400000).toISOString()};
          assert.equal(stock.getStatus(p), context.getStatus(p));
          assert.equal(stock.isDepletingSoon(p,now), context.isDepletingSoon(p));
          assert.equal(stock.isSuggested(p,now), context.isSuggested(p));
          assert.equal(stock.quantityNeeded(p), Math.max(0,5-quantity));
          count++;
        }
  assert.equal(count,3000);
});
test('application reliée au module, sans changement des chemins de données', () => {
  const html = readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html, /<script src="src\/domain\/stock.js"><\/script>/);
  assert.equal((html.match(/InventoryStock.quantityNeeded\(p\)/g)||[]).length,3);
  const sw = readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  assert.ok(sw.includes("'./src/domain/stock.js'"));
});
