import test from 'node:test';import assert from 'node:assert/strict';
import {fixtureData,fixtureApply,fixtureRestore,validateFixture} from '../src/mobile/reducer.js';
import {restockHistory} from '../src/family/history.js';
import {addition,rows} from '../src/family/domain.js';import {parseList} from '../src/shopping/domain.js';
const uid='simulation_test',initial=()=>({...fixtureData(),status:'active'});
const buy=(state,q=1e6)=>({actorUid:uid,operationId:crypto.randomUUID(),confirmed:true,targetCollection:'products',targetId:'milk',expectedRevision:state.products[0].revision,expectedGroupRevision:state.groups[0]?.revision||0,action:'purchase',choice:'unchanged',valueMicros:q});
test('niveau 1 : simulation indépendante, import manuel sans effet produit et choix 2/3/5',async()=>{
 for(const [choice,total] of [['keep',2],['set_total',3],['add_extra',5]]){const state=initial(),row=parseList('lait x3',[{id:'milk',name:'Lait',unit:'L'}])[0],c=await addition(uid,row,{products:state.products,groups:[]},choice);const after=fixtureApply(state,c,uid,'a');assert.equal(after.groups[0].totalMicros,total*1e6);assert.deepEqual(after.products,state.products);}
});
test('niveau 1 : achats réels, reste, rejeu et compensation ne perdent pas les sources',async()=>{
 let state=initial();const row=parseList('lait x3',[{id:'milk',name:'Lait',unit:'L'}])[0];state=fixtureApply(state,await addition(uid,row,{products:state.products,groups:[]},'add_extra'),uid,'a');const c=buy(state,1500000),sources=structuredClone(state.groups[0].contributions);state=fixtureApply(state,c,uid,'b');assert.equal(state.products[0].stockMicros,2500000);assert.equal(state.groups[0].totalMicros,3500000);assert.equal(fixtureApply(state,c,uid,'b').operations.length,2);
 const undo={...c,operationId:'undo_'+c.operationId,expectedRevision:2,expectedGroupRevision:2,action:'undoPurchase',compensates:c.operationId,choice:'add_extra',choiceValueMicros:1500000};state=fixtureApply(state,undo,uid,'c');assert.equal(state.products[0].stockMicros,1000000);assert.equal(state.groups[0].totalMicros,5000000);assert.deepEqual(state.groups[0].contributions,sources);assert.throws(()=>fixtureApply(state,{...undo,choice:'keep',choiceValueMicros:0},uid,'d'),/compensation-decision-conflict/);
});
test('niveau 1 : conflits de révisions et révocation simulée, sans somme implicite',()=>{
 const s=initial(),c=buy(s),next=fixtureApply(s,c,uid,'a');assert.throws(()=>fixtureApply(next,{...c,operationId:crypto.randomUUID()},uid,'b'),/preview-obsolete/);assert.throws(()=>fixtureApply({...s,status:'revoked'},c,uid,'a'),e=>e.code==='permission-denied');assert.equal(s.products[0].stockMicros,1e6);
});
test('niveau 1 : restauration atomique préparée, idempotence, conflits et statut non restauré',()=>{
 const s=initial(),file={format:'inventaire-mobile-fixture',version:1,data:s};assert.equal(fixtureRestore(s,file).added.length,0);const altered=structuredClone(file);altered.data.products[0].stockMicros=5;assert.equal(fixtureRestore(s,altered).conflicts.length,1);const missing={...s,products:[]};const plan=fixtureRestore(missing,file);assert.equal(plan.added.length,4);assert.equal(plan.next.status,'active');assert.throws(()=>fixtureRestore(s,{...file,version:99}));assert.equal(s.products[0].stockMicros,1e6);
});
test('statistiques : historique ancien préservé, quantités réellement achetées et annulations',()=>{
 const product={id:'milk',legacy:{restockHistory:[{date:'2020-01-01',qty:2,by:'Ancien'}]}},events=[{id:'p1',targetId:'milk',action:'purchase',valueMicros:1500000,createdAt:'2026-11-01',authorUid:uid},{id:'p2',targetId:'milk',action:'purchase',valueMicros:500000,createdAt:'2026-11-02',authorUid:uid},{id:'u1',targetId:'milk',action:'undoPurchase',receipt:{compensates:'p1'}}];const before=structuredClone(product),history=restockHistory(product,events);assert.equal(history.length,2);assert.equal(history[1].qty,.5);assert.equal(history[0].by,'Ancien');assert.deepEqual(product,before);
});

import {boundedHistory} from '../src/family/pagination.js';
test('statistiques : pagination bornée, dernière page partielle, limite et curseur natif',async()=>{
 const all=Array.from({length:47},(_,i)=>({id:String(i),native:{nanoseconds:i}}));let calls=0;
 const read=async(cursor,size)=>{calls++;const start=cursor?all.indexOf(cursor)+1:0,events=all.slice(start,start+size);return {events,cursor:events.at(-1)};};
 const full=await boundedHistory(read);assert.equal(full.complete,true);assert.deepEqual(full.events,all);assert.equal(calls,3);
 const capped=await boundedHistory(read,21);assert.equal(capped.complete,false);assert.equal(capped.events.length,21);assert.equal(capped.events.at(-1),all[20]);
 const exact=await boundedHistory(read,47);assert.equal(exact.complete,true);assert.deepEqual(exact.events,all);await assert.rejects(boundedHistory(read,201),/history-cap/);
});
test('recette : fichiers malformés, groupes et opérations invalides refusés avant restauration',async()=>{
 const s=initial(),row=parseList('lait x3',[{id:'milk',name:'Lait',unit:'L'}])[0],state=fixtureApply(s,await addition(uid,row,{products:s.products,groups:[]},'add_extra'),uid,'a');
 for(const mutate of [x=>x.groups[0].totalMicros=-1,x=>x.groups[0].contributions[Object.keys(x.groups[0].contributions)[0]].quantityMicros=0,x=>x.operations[0].action='invented',x=>x.products.push(x.products[0]),x=>x.version=99]){const bad=structuredClone(state);mutate(bad);assert.throws(()=>validateFixture(bad));assert.throws(()=>fixtureRestore(s,{format:'inventaire-mobile-fixture',version:1,data:bad}));}assert.equal(s.groups.length,0);
});
