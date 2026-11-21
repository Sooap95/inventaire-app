import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDocFromServer,getDocs,collection,Timestamp,setLogLevel,writeBatch,serverTimestamp} from 'firebase/firestore';
import {familyWriter} from '../src/family-writer.mjs';
import {PROJECT,EMULATOR} from '../src/contracts.mjs';
setLogLevel('silent');let env;
const users=['family-alice','family-bob','family-carol'];
const db=(uid=users[0])=>env.authenticatedContext(uid,{firebase:{sign_in_provider:'anonymous'}}).firestore();
const admin=fn=>env.withSecurityRulesDisabled(c=>fn(c.firestore()));
const product=()=>({schemaVersion:2,id:'milk',revision:1,name:'Lait',unit:'L',stockMicros:1000000,thresholdMicros:1000000,targetMicros:3000000,frequency:'',lastRestocked:Timestamp.fromMillis(1000),deleted:false,legacy:{retained:'fictional'},createdBy:users[0],authorUid:users[0],updatedAt:Timestamp.fromMillis(1),lastOperationId:'bootstrap-milk'});
const read=async(store,col='products',id='milk')=>(await getDocFromServer(doc(store,col,id))).data();
const command=(o={})=>({actorUid:users[0],operationId:crypto.randomUUID(),confirmed:true,targetCollection:'shoppingLines',targetId:'product_milk',expectedRevision:0,expectedProductRevision:1,productId:'milk',action:'add',entryId:crypto.randomUUID(),quantityMicros:3000000,choice:'add_extra',valueMicros:3000000,...o});
const buy=(o={})=>command({targetCollection:'products',targetId:'milk',action:'purchase',expectedRevision:1,expectedGroupRevision:0,valueMicros:1000000,...o});
const undo=(purchase,o={})=>buy({action:'undoPurchase',compensates:purchase.operationId,operationId:'undo_'+purchase.operationId,expectedRevision:2,choice:'unchanged',valueMicros:purchase.valueMicros,...o});
test.before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,EMULATOR);env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});});
test.beforeEach(async()=>{await env.clearFirestore();await admin(async s=>{for(const uid of users)await setDoc(doc(s,'members',uid),{schemaVersion:2,uid,role:'device',status:'active',authType:'anonymous'});await setDoc(doc(s,'products','milk'),product());});});
test.after(async()=>env?.cleanup());
test('v2 : événements compacts, contributions intactes et aucun stock écrit à l’import',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());const p=await read(s),g=await read(s,'shoppingLines','product_milk');
 assert.equal(p.stockMicros,1000000);assert.equal(g.totalMicros,5000000);
 const op=(await getDocs(collection(s,'operations'))).docs[0].data();assert.equal(op.schemaVersion,2);assert.equal(op.receipt,null);assert.ok(!('legacy'in op.after));assert.ok(!('contributions'in op.after));
});
test('achat automatique partiel : quantité réelle, rejeu, annulation compensatrice unique',async()=>{
 const s=db(),w=familyWriter(s,users[0]),c=buy();await w(c);assert.equal((await read(s)).stockMicros,2000000);await w(c);assert.equal((await read(s)).revision,2);
 const cancel=undo(c);await w(cancel);await w(cancel);const p=await read(s);assert.equal(p.stockMicros,1000000);assert.equal(p.lastRestocked.toMillis(),1000);assert.equal((await getDocs(collection(s,'operations'))).size,2);
});
test('achat mixte : stock + réel, reste réduit sans perdre les contributions ni leurs coches',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());const g=await read(s,'shoppingLines','product_milk');const c=buy({expectedGroupRevision:1,valueMicros:2000000});await w(c);
 const after=await read(s,'shoppingLines','product_milk');assert.equal(after.totalMicros,3000000);assert.equal(after.fulfilledMicros,2000000);assert.deepEqual(after.contributions,g.contributions);assert.equal((await read(s)).stockMicros,3000000);
 await w(undo(c,{expectedGroupRevision:2,choice:'add_extra',choiceValueMicros:2000000}));assert.equal((await read(s,'shoppingLines','product_milk')).totalMicros,5000000);
});
test('annulation mixte : garder ou fixer le total exige un choix explicite',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());const c=buy({expectedGroupRevision:1});await w(c);
 await assert.rejects(w(undo(c,{expectedGroupRevision:2})),/explicit-shopping-choice/);
 await w(undo(c,{expectedGroupRevision:2,choice:'set_total',choiceValueMicros:2500000}));assert.equal((await read(s,'shoppingLines','product_milk')).totalMicros,2500000);
});
test('article libre : achat et annulation sans créer ni modifier de produit',async()=>{
 const s=db(),w=familyWriter(s,users[0]),id='free_fictional01';await w(command({targetId:id,productId:null,name:'Pommes',unit:'kg',expectedProductRevision:0,quantityMicros:3000000,valueMicros:3000000,choice:'set_total'}));
 const c=buy({targetCollection:'shoppingLines',targetId:id,action:'purchaseFree',expectedRevision:1,valueMicros:1500000});await w(c);assert.equal((await read(s,'shoppingLines',id)).totalMicros,1500000);
 await w(undo(c,{targetCollection:'shoppingLines',targetId:id,action:'undoPurchaseFree',expectedRevision:2,choice:'keep',choiceValueMicros:0}));
 assert.equal((await read(s)).revision,1);assert.equal((await getDocs(collection(s,'products'))).size,1);assert.equal((await read(s,'shoppingLines',id)).totalMicros,1500000);
});
test('concurrence : deux achats même révision, un conflit explicite, aucun achat écrasé',async()=>{
 const a=db(),b=db(users[1]);const c=buy(),d=buy({actorUid:users[1]});const result=await Promise.allSettled([familyWriter(a,users[0])(c),familyWriter(b,users[1])(d)]);
 assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.equal(result.find(x=>x.status==='rejected').reason.code,'sync-conflict');assert.equal((await read(a)).stockMicros,2000000);
});
test('concurrence : deux annulations du même reçu ne soustraient qu’une fois',async()=>{
 const s=db(),c=buy();await familyWriter(s,users[0])(c);await Promise.all([familyWriter(s,users[0])(undo(c)),familyWriter(db(users[1]),users[1])(undo(c,{actorUid:users[1]}))]);assert.equal((await read(s)).stockMicros,1000000);
});
test('annulations hors ordre : stock par delta et date du dernier achat non annulé',async()=>{
 const s=db(),w=familyWriter(s,users[0]),a=buy();await w(a);const b=buy({expectedRevision:2});await w(b);await w(undo(a,{expectedRevision:3}));assert.equal((await read(s)).lastPurchaseId,b.operationId);await w(undo(b,{expectedRevision:4}));assert.equal((await read(s)).stockMicros,1000000);assert.equal((await read(s)).lastRestocked.toMillis(),1000);
});
test('annulation : stock consommé entre-temps, refus du stock négatif',async()=>{
 const s=db(),w=familyWriter(s,users[0]),c=buy();await w(c);await w(command({targetCollection:'products',targetId:'milk',action:'product.write',entryId:null,choice:'unchanged',valueMicros:0,expectedRevision:2,data:{stockMicros:0}}));await assert.rejects(w(undo(c,{expectedRevision:3})),/stock-range/);assert.equal((await read(s)).stockMicros,0);
});
test('stock modifié : décision périmée et achat bloqué avant réexamen explicite',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());await w(command({targetCollection:'products',targetId:'milk',action:'product.write',entryId:null,choice:'unchanged',valueMicros:0,expectedRevision:1,data:{stockMicros:0}}));await assert.rejects(w(buy({expectedRevision:2,expectedGroupRevision:1})),/quantity-review/);
});
test('révocation et usurpation : aucun achat ni reçu partiel',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await assert.rejects(w(buy({actorUid:users[1]})),/actor-mismatch/);await admin(s=>setDoc(doc(s,'members',users[0]),{schemaVersion:2,uid:users[0],role:'device',status:'revoked',authType:'anonymous'}));await assertFails(w(buy()));await admin(async s=>{assert.equal((await read(s)).stockMicros,1000000);assert.equal((await getDocs(collection(s,'operations'))).size,0);});
});
test('sécurité : achat falsifié sans groupe couplé refusé atomiquement',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());const p=await read(s),opId=crypto.randomUUID();const after={...p,revision:2,stockMicros:2000000,lastRestocked:serverTimestamp(),lastPurchaseId:opId,authorUid:users[0],updatedAt:serverTimestamp(),lastOperationId:opId};
 const batch=writeBatch(s);batch.set(doc(s,'products','milk'),after);await assertFails(batch.commit());assert.equal((await read(s)).stockMicros,1000000);
});
test('case automatique sans contribution : groupe initialisé et stock inchangé',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command({action:'init',entryId:null,choice:'unchanged',valueMicros:0,checked:true}));const g=await read(s,'shoppingLines','product_milk');assert.equal(g.totalMicros,2000000);assert.equal(g.automaticChecked,true);assert.equal(Object.keys(g.contributions).length,0);assert.equal((await read(s)).stockMicros,1000000);
});
test('achat puis annulation : reçus immuables et pas de suppression des contributions cochées',async()=>{
 const s=db(),w=familyWriter(s,users[0]),add=command();await w(add);await w(command({action:'check',entryId:add.entryId,expectedRevision:1,checked:true,choice:'unchanged',valueMicros:0}));const original=await read(s,'shoppingLines','product_milk'),c=buy({expectedGroupRevision:2});await w(c);await w(undo(c,{expectedGroupRevision:3,choice:'keep'}));const after=await read(s,'shoppingLines','product_milk');assert.deepEqual(after.contributions,original.contributions);assert.deepEqual(after.checks,original.checks);await assertFails(setDoc(doc(s,'operations',c.operationId),{invalid:true}));
});
test('fréquence hebdomadaire : achat et contexte serveur à la même date',async()=>{
 await admin(s=>setDoc(doc(s,'products','milk'),productWithFrequency()));const s=db(),w=familyWriter(s,users[0]);await w(command());await w(buy({expectedGroupRevision:1,valueMicros:2000000}));assert.equal((await read(s,'shoppingLines','product_milk')).automaticMicros,0);
});
function productWithFrequency(){return {...product(),frequency:'hebdomadaire'};}
test('reçu v2 falsifié : groupe omis, unité modifiée ou contribution écrasée refusés',async()=>{
 const {compactAfter}=await import('../src/events.mjs');const s=db(),w=familyWriter(s,users[0]),c=command();await w(c);const p=await read(s),g=await read(s,'shoppingLines','product_milk');
 for(const attack of ['missing-group','unit-change','source-overwrite']){
  const id=crypto.randomUUID(),after={...p,revision:2,stockMicros:2000000,lastRestocked:serverTimestamp(),lastPurchaseId:id,updatedAt:serverTimestamp(),lastOperationId:id};
  const group={...g,revision:2,productRevision:2,automaticMicros:0,totalMicros:4000000,fulfilledMicros:1000000,automaticChecked:false,needsReview:false,updatedAt:serverTimestamp(),lastOperationId:id};
  if(attack==='unit-change')after.unit='kg';if(attack==='source-overwrite')group.contributions={};
  const event={schemaVersion:2,id,authorUid:users[0],createdAt:serverTimestamp(),targetCollection:'products',targetId:'milk',beforeRevision:1,afterRevision:2,action:'purchase',entryId:null,choice:'unchanged',valueMicros:1000000,confirmed:true,requestHash:'a'.repeat(64),after:compactAfter(after,'products'),receipt:{groupId:g.id,groupBeforeRevision:1,groupAfterRevision:2,demandMicros:1000000,compensates:null,previousPurchaseId:null,previousLastRestocked:p.lastRestocked,rollbackPurchaseId:null,rollbackRestocked:null,choiceValueMicros:0}};
  const b=writeBatch(s);b.set(doc(s,'products','milk'),after);if(attack!=='missing-group')b.set(doc(s,'shoppingLines',g.id),group);b.set(doc(s,'operations',id),event);await assertFails(b.commit());
 }
 assert.equal((await read(s)).stockMicros,1000000);assert.equal((await read(s,'shoppingLines',g.id)).contributions[c.entryId].quantityMicros,3000000);
});
test('100 contributions : achat conserve toutes les sources sans dupliquer le groupe dans le reçu',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());const g=await read(s,'shoppingLines','product_milk');const entries=Object.fromEntries(Array.from({length:100},(_,i)=>{const id='contribution-cap-'+String(i).padStart(3,'0');return [id,{id,revision:1,quantityMicros:1000000,status:'active',createdBy:users[0],authorUid:users[0]}];}));await admin(s=>setDoc(doc(s,'shoppingLines',g.id),{...g,contributions:entries,checks:{}}));const c=buy({expectedGroupRevision:1});await w(c);const after=await read(s,'shoppingLines',g.id),event=await read(s,'operations',c.operationId);assert.deepEqual(after.contributions,entries);assert.ok(JSON.stringify(event).length<4000);assert.ok(JSON.stringify(after).length>12000);
});
test('annulations concurrentes avec choix différents : un succès, un conflit visible, un seul effet de stock',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());const c=buy({expectedGroupRevision:1});await w(c);const left=undo(c,{expectedGroupRevision:2,choice:'keep'}),right=undo(c,{actorUid:users[1],expectedGroupRevision:2,choice:'add_extra',choiceValueMicros:1000000});
 const results=await Promise.allSettled([w(left),familyWriter(db(users[1]),users[1])(right)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.message,'compensation-decision-conflict');assert.equal((await read(s)).stockMicros,1000000);
 const event=await read(s,'operations',left.operationId),g=await read(s,'shoppingLines','product_milk');assert.equal(g.totalMicros,event.choice==='keep'?4000000:5000000);
});
test('compensation déjà enregistrée : même total idempotent, total différent refusé sans nouvel effet',async()=>{
 const s=db(),w=familyWriter(s,users[0]);await w(command());const c=buy({expectedGroupRevision:1});await w(c);const a=undo(c,{expectedGroupRevision:2,choice:'set_total',choiceValueMicros:2000000});await w(a);assert.equal((await w(a)).replayed,true);await assert.rejects(w({...a,choiceValueMicros:3000000}),/compensation-decision-conflict/);await assert.rejects(w({...a,expectedRevision:3,expectedGroupRevision:3}),/compensation-decision-conflict/);assert.equal((await read(s)).stockMicros,1000000);assert.equal((await read(s,'shoppingLines','product_milk')).totalMicros,2000000);
});
