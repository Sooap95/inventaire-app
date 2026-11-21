import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {emptyState,parseList,planBatch,project,active,reviewTotal} from '../src/shopping/domain.js';
import {validateState} from '../src/shopping/backup.js';
const products=[{id:'milk',name:'Lait',stock:1,threshold:1,target:3,unit:'L'}];
function initial(){const rows=parseList('lait x3',products);return planBatch(emptyState(),products,rows,{[rows[0].id]:'add_extra'}).next;}
test('pré3 : produit supprimé, dernier total gardé et réexamen obligatoire',()=>{
 const state=initial(),view=project(state.lines[0],[]);
 assert.equal(view.quantity,'5');assert.equal(view.needsReview,true);assert.equal(view.missingProduct,true);
 assert.throws(()=>reviewTotal(state,[],state.lines[0].id,'3'),e=>e.code==='product');
});
test('pré3 : détachement explicite en article libre, même contribution versionnée et historique conservé',()=>{
 const state=initial(),old=state.lines[0].contributions[0],rows=parseList('lait x3',[]);
 rows[0].editId=old.id;rows[0].unit='L';rows[0].distinctFree=true;
 const next=planBatch(state,[],rows).next;
 assert.equal(active(next.lines[0]).length,0);assert.equal(next.lines[0].contributions[0].id,old.id);
 const line=next.lines.find(l=>l.productId===null);assert.equal(active(line)[0].id,old.id);assert.equal(active(line)[0].revision,2);
 assert.equal(project(line,[]).quantity,'3');validateState(next);
 assert.equal(products[0].stock,1);
});
test('pré3 : association nouvelle demande un choix explicite sur le doublon',()=>{
 const state=initial(),target=[{...products[0],id:'other'}],rows=parseList('lait x3',target);
 rows[0].editId=state.lines[0].contributions[0].id;
 assert.equal(planBatch(state,target,rows).error,'choice');
 const plan=planBatch(state,target,rows,{[rows[0].id]:'add_extra'});
 assert.equal(project(plan.next.lines.find(l=>l.productId==='other'),target).quantity,'5');
 rows[0].requiresAssociation=true;assert.equal(planBatch(state,target,rows).error,'product');
});
test('pré3 : réassociation incompatible refusée sans changement partiel',()=>{
 const state=initial(),before=structuredClone(state),target=[{...products[0],id:'other',unit:'boîte'}];
 const rows=parseList('lait x3',target);rows[0].editId=state.lines[0].contributions[0].id;rows[0].unit='L';
 assert.equal(planBatch(state,target,rows,{[rows[0].id]:'add_extra'}).error,'units');assert.deepEqual(state,before);
});
function worker(cache){
 const handlers={},self={registration:{scope:'https://fixture.invalid/inventaire/'},clients:{claim:async()=>{}},addEventListener:(k,v)=>handlers[k]=v};
 const context={self,caches:cache,URL,Request:class{constructor(url,options){this.url=url;this.options=options;}},fetch:async()=>{throw Error('unexpected network');}};
 vm.runInNewContext(readFileSync(new URL('../sw.js',import.meta.url),'utf8'),context);return {handlers,self};
}
test('pré3 : installation du shell atomique, échec conservant les anciens caches',async()=>{
 const deleted=[];let optional=0;
 const {handlers}=worker({open:async()=>({addAll:async requests=>{assert.ok(requests.length>=11);assert.ok(requests.every(r=>r.options.cache==='reload'));throw Error('missing asset');},add:async()=>optional++}),delete:async k=>deleted.push(k)});
 let work;handlers.install({waitUntil:p=>work=p});await assert.rejects(work,/missing asset/);
 assert.deepEqual(deleted,['inventaire-maison-v10-quick-stock']);assert.equal(optional,0);
});
test('pré3 : worker attend la fermeture des anciens clients, SDK auth dans les ressources optionnelles',async()=>{
 const optional=[];const {handlers,self}=worker({open:async()=>({addAll:async()=>{},add:async u=>optional.push(u)})});
 self.skipWaiting=()=>assert.fail('activation forcée');let work;handlers.install({waitUntil:p=>work=p});await work;
 assert.ok(optional.some(u=>u.endsWith('firebase-auth-compat.js')));
});
test('pré3 : lecture dans le cache courant seulement, aucune interception des API ou laboratoires',async()=>{
 const opened=[],matched=[];const {handlers}=worker({open:async name=>{opened.push(name);return {match:async url=>{matched.push(url);return 'current-version';}}},match:()=>assert.fail('cache global')});
 let response;handlers.fetch({request:{method:'GET',url:'https://fixture.invalid/inventaire/index.html?test=1'},respondWith:p=>response=p});
 assert.equal(await response,'current-version');assert.equal(opened[0],'inventaire-maison-v10-quick-stock');
 assert.equal(matched[0],'https://fixture.invalid/inventaire/index.html');
 for(const url of ['https://firestore.googleapis.com/fixture','https://world.openfoodfacts.org/fixture','https://fixture.invalid/inventaire/labs/ocr/'])handlers.fetch({request:{method:'GET',url},respondWith:()=>assert.fail('API ou lab intercepté')});
});
