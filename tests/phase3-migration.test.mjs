import test from 'node:test';
import assert from 'node:assert/strict';
import {migrationPlan} from '../security/src/migration-plan.mjs';
import {emptyState,parseList,planBatch} from '../src/shopping/domain.js';
const products=[{id:'historical-unchanged',name:'Lait',unit:'L',stock:1,threshold:1,target:3,restockHistory:[{qty:2,date:'2020-01-01',by:'ancien prénom fictif'}],customField:'conservé'}];
function raw(){const rows=parseList('lait x3',products);return JSON.stringify({format:'inventaire-shopping-local',version:1,state:planBatch(emptyState(),products,rows,{[rows[0].id]:'set_total'}).next});}
test('migration sèche : ID, unités, historique et champs inconnus conservés, aucune entrée modifiée',async()=>{
 const backup=raw(),before=structuredClone(products),plan=await migrationPlan(backup,products,'family-alice');
 assert.equal(plan.mode,'dry-run-only');assert.equal(plan.readyForProduction,false);assert.equal(plan.requiresAdministrativeReview,true);
 assert.equal(plan.products[0].id,products[0].id);assert.equal(plan.products[0].stockMicros,1000000);
 assert.deepEqual(plan.products[0].legacy,products[0]);assert.deepEqual(products,before);
 assert.equal(plan.groups[0].proposedTotalMicros,3000000);
 const decoded=JSON.parse(backup).state.lines[0].contributions[0];assert.equal(plan.groups[0].contributions[0].id,decoded.id);
});
test('migration sèche : précision, unité absente et ID en conflit bloqués sans arrondi ou renommage',async()=>{
 const p=[{...products[0],stock:0.1234567},{...products[0],id:'no-unit',unit:''},{...products[0]}];
 const plan=await migrationPlan(raw(),p,'family-alice');
 assert.deepEqual(plan.issues.filter(i=>Object.hasOwn(i,'productId')).map(i=>i.type),['precision-requires-review','unit-requires-review','product-id-conflict']);
 assert.ok(plan.issues.some(i=>i.localGroupId&&i.type==='precision'));
 assert.equal(plan.readyForProduction,false);
});
test('migration sèche : produit supprimé et total périmé requièrent un arbitrage',async()=>{
 const missing=await migrationPlan(raw(),[],'family-alice');assert.equal(missing.issues[0].type,'deleted-product-requires-resolution');
 const stale=await migrationPlan(raw(),[{...products[0],stock:0}],'family-alice');assert.equal(stale.groups[0].requiresQuantityReview,true);
 assert.equal(stale.groups[0].proposedTotalMicros,3000000);
});
test('migration sèche : archive exhaustive réassemblable, identifiants stables et auteur administratif distinct',async()=>{
 const backup=raw(),a=await migrationPlan(backup,products,'family-alice'),b=await migrationPlan(backup,products,'family-alice');
 assert.deepEqual(a.archives,b.archives);
 assert.equal(Buffer.concat(a.archives.map(p=>Buffer.from(p.payload,'base64'))).toString('utf8'),backup);
 assert.equal(a.archives[0].administrativeAuthorUid,'family-alice');assert.equal(a.archives[0].kind,'migration.archive');
});
test('migration sèche : mauvais fichier ou opérateur absent refusé, aucun UID local deviné',async()=>{
 await assert.rejects(migrationPlan('{',products,'family-alice'),e=>e.code==='restore-format');
 await assert.rejects(migrationPlan(raw(),products,''),/administrative-operator/);
});
