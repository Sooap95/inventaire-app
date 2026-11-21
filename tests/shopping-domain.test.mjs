import test from 'node:test';
import assert from 'node:assert/strict';
import {parseList,matchProduct,normalizeName,convert,emptyState,planBatch,project,active,removeContribution,toggleContribution,reviewTotal,inventorySignature} from '../src/shopping/domain.js';
import {memoryStore} from '../src/shopping/store.js';
const products=[
 {id:'lait',name:'Lait',unit:'L',stock:1,threshold:1,target:3},
 {id:'beurre',name:'Beurre',unit:'paquets',stock:5,threshold:1,target:3},
 {id:'aptamil',name:'Aptamil',unit:'boîtes',stock:2,threshold:0,target:2},
 {id:'oeufs',name:'Œufs',unit:'boîtes',stock:4,threshold:1,target:3}
];
function parse(s,p=products){let id=0;return parseList(s,p,[],()=>`row-${++id}`);}
function add(state,text,choice){const rows=parse(text);rows[0].id=crypto.randomUUID();const result=planBatch(state,products,rows,choice?{[rows[0].id]:choice}:{});assert.equal(result.error,null);return result.next;}
test('quantité absente : proposition 1, article libre accepté',()=>{
 const [row]=parse('pommes');assert.equal(row.quantity,'1');assert.equal(row.productId,null);assert.equal(row.unit,'article');
 const state=planBatch(emptyState(),products,[row]).next;assert.equal(project(state.lines[0],products).quantity,'1');
});
test('x2, ×2, préfixe, suffixe et décimales FR/DE',()=>{
 for(const text of ['beurre x2','beurre ×2','beurre × 2','2 beurres'])assert.equal(parse(text)[0].quantity,'2');
 for(const text of ['lait 2 L','2 L lait']){const [r]=parse(text);assert.equal(r.name,'lait');assert.equal(r.quantity,'2');assert.equal(r.unit,'L');}
 for(const text of ['beurre x2,5','beurre × 2.5','2,5 kg pommes','pommes 2.5 kg'])assert.equal(parse(text)[0].quantity,'2.5');
 assert.equal(parse('2 Liter Milch',[])[0].unit,'Liter');
});
test('œufs : boîtes implicites et œufs individuels explicites, sans conversion',()=>{
 const a=parse('œufs')[0],b=parse('œufs x2')[0],c=parse('12 œufs')[0];
 assert.deepEqual([a.quantity,a.unit],['1','boîte']);assert.deepEqual([b.quantity,b.unit],['2','boîte']);assert.deepEqual([c.quantity,c.unit],['12','œuf']);
 assert.throws(()=>convert('12','œuf','boîtes'),e=>e.code==='units');
 assert.equal(planBatch(emptyState(),products,[c]).error,'units');
 c.productId=null;c.distinctFree=true;assert.equal(planBatch(emptyState(),products,[c]).error,null);
});
test('normalisation accents, ligature, espaces, majuscules et allemand',()=>{
 assert.equal(normalizeName('  ŒUFS  '),'oeufs');assert.equal(normalizeName('Äpfel'),'apfel');
 assert.equal(parse('  LAIT   2 L ')[0].productId,'lait');
 assert.equal(matchProduct('sans nom',products,[],'aptamil').product.id,'aptamil');
});
test('Atamil : proposition Aptamil sans remplacement ; alias seulement confirmé',()=>{
 const [r]=parse('Atamil x1');assert.equal(r.name,'Atamil');assert.equal(r.productId,null);assert.equal(r.candidates[0].id,'aptamil');
 assert.equal(emptyState().aliases.length,0);
 r.productId='aptamil';r.unit='boîtes';r.rememberAlias=true;
 const result=planBatch(emptyState(),products,[r]);assert.equal(result.error,null);
 assert.equal(parseList('Atamil',products,result.next.aliases)[0].productId,'aptamil');
 assert.equal(products[2].name,'Aptamil');
});
test('auto 2 + saisie 3 : aucune option par défaut, choix 2 / 3 / 5',()=>{
 const rows=parse('lait x3'),id=rows[0].id;
 const missing=planBatch(emptyState(),products,rows);assert.equal(missing.error,'choice');assert.equal(missing.next,null);
 for(const [choice,total]of [['keep','2'],['set_total','3'],['add_extra','5']]){
  const result=planBatch(emptyState(),products,rows,{[id]:choice});assert.equal(result.steps[0].total,total);
  if(choice!=='keep')assert.equal(project(result.next.lines[0],products).quantity,total);
  else assert.equal(active(result.next.lines[0]).length,0);
 }
});
test('doublons entre deux listes et dans un collage unique',()=>{
 const state=add(emptyState(),'pommes x2');const rows=parse('pommes x3');
 assert.equal(planBatch(state,products,rows).error,'choice');
 assert.equal(project(planBatch(state,products,rows,{[rows[0].id]:'add_extra'}).next.lines[0],products).quantity,'5');
 const same=parse('pommes x2\npommes x3');assert.equal(planBatch(emptyState(),products,same).steps[1].error,'choice');
});
test('unités incompatibles refusées et conversions métriques exactes',()=>{
 const rows=parse('lait 3 bouteilles');assert.equal(planBatch(emptyState(),products,rows,{[rows[0].id]:'add_extra'}).error,'units');
 assert.equal(convert('1','kg','g'),'1000');assert.equal(convert('250','mL','L'),'0.25');
 const result=planBatch(emptyState(),products,parse('lait 3000 mL'),{'row-1':'set_total'});assert.equal(project(result.next.lines[0],products).quantity,'3');
 const state=add(add(emptyState(),'pommes x0,1'),'pommes x0.2','add_extra');assert.equal(project(state.lines[0],products).quantity,'0.3');
});
test('quantités malformées : aucun retour silencieux à 1',()=>{
 for(const text of ['beurre x-2','beurre x0','1/2 beurre','lait -2']){const row=parse(text)[0];assert.equal(row.ambiguous,true);assert.notEqual(planBatch(emptyState(),products,[row]).error,null);}
});
test('ni produit, stock, cible, seuil ni historique modifiés par l’import',()=>{
 const before=structuredClone(products),signature=inventorySignature(products);
 add(emptyState(),'lait x3','add_extra');add(emptyState(),'produit libre');
 assert.deepEqual(products,before);assert.equal(inventorySignature(products),signature);
});
test('retirer un supplément conserve le besoin auto 2 et les produits',()=>{
 const state=add(emptyState(),'lait x3','add_extra'),line=state.lines[0];
 const next=removeContribution(state,line.id,line.contributions[0].id);
 assert.equal(project(next.lines[0],products).quantity,'2');assert.equal(next.lines[0].productId,'lait');assert.equal(products.length,4);
});
test('total choisi à réexaminer après stock changé, suppression ou édition',()=>{
 const state=add(add(emptyState(),'lait x3','set_total'),'lait x1','add_extra'),line=state.lines[0];
 assert.equal(project(line,products).quantity,'4');
 const changed=products.map(p=>p.id==='lait'?{...p,stock:2}:p);
 assert.equal(project(line,changed).needsReview,true);assert.equal(project(line,changed).quantity,'4');
 const removed=removeContribution(state,line.id,line.contributions[1].id);
 assert.equal(project(removed.lines[0],products).needsReview,true);
 const reviewed=reviewTotal(removed,products,line.id,'3');assert.equal(project(reviewed.lines[0],products).needsReview,false);
});
test('retrait de la contribution ayant fixé le total : réexamen si des ajouts subsistent',()=>{
 const state=add(add(emptyState(),'lait x3','set_total'),'lait x1','add_extra'),line=state.lines[0];
 const next=removeContribution(state,line.id,line.contributions[0].id),view=project(next.lines[0],products);
 assert.equal(view.needsReview,true);assert.equal(view.quantity,'4');assert.equal(view.calculatedQuantity,'3');
 const reviewed=reviewTotal(next,products,line.id,'3');assert.equal(project(reviewed.lines[0],products).needsReview,false);
});
test('cocher une contribution ne touche pas le stock et ne périme pas le total',()=>{
 const state=add(emptyState(),'lait x3','set_total'),line=state.lines[0];
 const next=toggleContribution(state,line.id,line.contributions[0].id,true);
 assert.equal(next.lines[0].contributions[0].checked,true);assert.equal(project(next.lines[0],products).needsReview,false);assert.equal(products[0].stock,1);
});
test('édition conserve l’identifiant de contribution et remplace son effet une fois',()=>{
 const state=add(emptyState(),'lait x3','add_extra'),line=state.lines[0],rows=parse('lait x4');
 rows[0].editId=line.contributions[0].id;
 const result=planBatch(state,products,rows,{[rows[0].id]:'add_extra'});
 assert.equal(result.error,null);assert.equal(active(result.next.lines[0])[0].id,rows[0].editId);assert.equal(project(result.next.lines[0],products).quantity,'6');
});
test('idempotence : la même opération rejouée ne valide pas deux fois',async()=>{
 const store=memoryStore(),next=add(emptyState(),'pommes');
 await store.commit(0,'op-1','payload',next);
 const repeated=await store.commit(0,'op-1','payload',next);
 assert.equal(repeated.replayed,true);assert.equal((await store.read()).revision,1);assert.equal(active((await store.read()).lines[0]).length,1);
 await assert.rejects(store.commit(1,'op-1','autre',next),e=>e.code==='operation');
});
test('modifications concurrentes : une seule réussit, autre conflit explicite',async()=>{
 const store=memoryStore(),a=add(emptyState(),'pommes'),b=add(emptyState(),'poires');
 const results=await Promise.allSettled([store.commit(0,'a','a',a),store.commit(0,'b','b',b)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'conflict');
 const state=await store.read();assert.equal(state.lines.length,1);assert.equal(state.lines[0].decisions.length,1);
});
test('collision libre/produit : clarification, pas de fusion silencieuse',()=>{
 const state=add(emptyState(),'pommes');const p=[...products,{id:'pomme-id',name:'pommes',unit:'kg',stock:0,threshold:1,target:2}];
 const rows=parseList('pommes',p);assert.equal(planBatch(state,p,rows).error,'identity');
});
test('retrait du dernier ajout après révision du total restaure uniquement l’auto',()=>{
 const state=add(emptyState(),'lait x3','set_total'),line=state.lines[0];
 const reviewed=reviewTotal(state,products,line.id,'4');
 const removed=removeContribution(reviewed,line.id,line.contributions[0].id);
 assert.equal(project(removed.lines[0],products).quantity,'2');
});
test('l’unité d’un article libre unique est modifiable explicitement',()=>{
 const state=add(emptyState(),'pommes'),rows=parse('pommes 2 kg');rows[0].editId=state.lines[0].contributions[0].id;
 const result=planBatch(state,products,rows);assert.equal(result.error,null);assert.equal(result.next.lines[0].unit,'kg');
});
test('œufs individuels libres confirmés n’empêchent pas ensuite les boîtes associées',()=>{
 const [individual]=parse('12 œufs');individual.productId=null;individual.distinctFree=true;
 const first=planBatch(emptyState(),products,[individual]).next;
 const result=planBatch(first,products,parse('œufs x2'));
 assert.equal(result.error,null);assert.equal(result.next.lines.filter(l=>active(l).length).length,2);
});
test('mélange décimal exact, sans changer le besoin automatique historique',()=>{
 const p=[{id:'lait',name:'Lait',unit:'L',stock:0.3,threshold:1,target:0.4}];
 const historic=globalThis.InventoryStock.quantityNeeded(p[0]);
 const rows=parse('lait 0,2 L',p),result=planBatch(emptyState(),p,rows,{'row-1':'add_extra'});
 assert.equal(result.error,null);assert.equal(project(result.next.lines[0],p).quantity,'0.3');
 assert.equal(globalThis.InventoryStock.quantityNeeded(p[0]),historic);
 const precise=[{...p[0],stock:0.1234567}];assert.equal(planBatch(emptyState(),precise,rows,{'row-1':'add_extra'}).error,'precision');
});
test('unité de produit changée : aucun calcul incompatible, clarification par retrait puis nouvelle saisie',()=>{
 const state=add(emptyState(),'lait x3','add_extra'),line=state.lines[0];
 const changed=products.map(p=>p.id==='lait'?{...p,unit:'bouteilles'}:p);
 assert.throws(()=>project(line,changed),e=>e.code==='units');
 const rows=parse('lait x3',changed);assert.equal(planBatch(state,changed,rows,{'row-1':'add_extra'}).error,'units');
 const removed=removeContribution(state,line.id,line.contributions[0].id);
 const confirmed=planBatch(removed,changed,rows,{'row-1':'add_extra'});
 assert.equal(confirmed.error,null);assert.equal(confirmed.next.lines[0].unit,'bouteilles');
 assert.equal(project(confirmed.next.lines[0],changed).quantity,'5');assert.equal(line.unit,'L');
});
