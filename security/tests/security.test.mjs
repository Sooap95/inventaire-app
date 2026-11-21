import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocFromServer,getDocs,collection,deleteDoc,writeBatch,serverTimestamp,Timestamp,setLogLevel} from 'firebase/firestore';
import {PROJECT,EMULATOR,toMicros,autoMicros,groupNeedsReview,assertEmulator} from '../src/contracts.mjs';
import {emulatorWriter} from '../src/emulator-writer.mjs';
setLogLevel('silent');
let env;
const users=['family-alice','family-bob','family-carol'];
function db(uid=users[0],provider='anonymous'){
 return uid?env.authenticatedContext(uid,{firebase:{sign_in_provider:provider}}).firestore():env.unauthenticatedContext().firestore();
}
function product(id='milk',overrides={}){return {schemaVersion:2,id,revision:1,name:'Lait',unit:'L',stockMicros:1000000,thresholdMicros:1000000,targetMicros:3000000,
 frequency:'',lastRestocked:null,deleted:false,legacy:{},createdBy:users[0],authorUid:users[0],updatedAt:Timestamp.fromMillis(1),lastOperationId:'bootstrap-milk',...overrides};}
async function admin(fn){return env.withSecurityRulesDisabled(c=>fn(c.firestore()));}
test.before(async()=>{
 if(process.env.FIRESTORE_EMULATOR_HOST!==EMULATOR)throw Error('Emulator endpoint required');
 env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
});
test.beforeEach(async()=>{
 await env.clearFirestore();
 await admin(async store=>{
  for(const uid of users)await setDoc(doc(store,'members',uid),{schemaVersion:2,uid,role:'device',status:'active',authType:'anonymous'});
  await setDoc(doc(store,'products','milk'),product());
 });
});
test.after(async()=>env?.cleanup());
function add(overrides={}){return {operationId:'operation-add-0001',targetCollection:'shoppingLines',targetId:'product_milk',expectedRevision:0,
 expectedProductRevision:1,productId:'milk',action:'add',entryId:'contribution-0001',quantityMicros:3000000,choice:'add_extra',valueMicros:3000000,confirmed:true,...overrides};}
test('auth : déconnecté refusé',async()=>assertFails(getDoc(doc(db(null),'products','milk'))));
test('auth : anonyme inconnu refusé',async()=>assertFails(getDoc(doc(db('unknown-anon','anonymous'),'products','milk'))));
test('auth : compte non membre refusé',async()=>assertFails(getDoc(doc(db('outsider'),'products','milk'))));
test('auth : chacun des trois membres autorisé',async()=>{for(const uid of users)await assertSucceeds(getDoc(doc(db(uid),'products','milk')));});
test('shopping : écriture et événement atomiques, choix explicite 5',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);await write(add());
 assert.equal((await getDoc(doc(store,'shoppingLines','product_milk'))).data().totalMicros,5000000);
 assert.equal((await getDocs(collection(store,'operations'))).size,1);
});
function pair(store,col,id,before,patch={},opPatch={},uid=users[0]){
 const operationId='raw-operation-'+crypto.randomUUID();
 const after={...before,revision:(before?.revision||0)+1,authorUid:uid,updatedAt:serverTimestamp(),lastOperationId:operationId,...patch};
 const event={schemaVersion:1,id:operationId,authorUid:uid,createdAt:serverTimestamp(),targetCollection:col,targetId:id,
  beforeRevision:before?.revision||0,afterRevision:after.revision,action:col==='products'?'product.write':'review',entryId:null,
  choice:col==='products'?'unchanged':'set_total',valueMicros:col==='products'?0:after.totalMicros,confirmed:true,requestHash:'a'.repeat(64),after,...opPatch};
 const batch=writeBatch(store);batch.set(doc(store,col,id),after);batch.set(doc(store,'operations',operationId),event);
 return {batch,after,event,operationId};
}
async function readGroup(store){return (await getDocFromServer(doc(store,'shoppingLines','product_milk'))).data();}
test('auth : refus sur les quatre collections et écriture valide pour les utilisateurs inconnus',async()=>{
 for(const [uid,provider] of [[null,'test-recoverable'],['anon','anonymous'],['outsider','test-recoverable']]){
  const store=db(uid,provider);
  for(const name of ['products','shoppingLines','operations','members'])await assertFails(getDocs(collection(store,name)));
  const id='new-product',base=product(id,{revision:0,createdBy:uid||'nobody'});
  await assertFails(pair(store,'products',id,base,{}, {},uid||'nobody').batch.commit());
 }
});
test('auth : membre révoqué refusé même avec son ancien jeton et données déjà lues',async()=>{
 const store=db();await assertSucceeds(getDocFromServer(doc(store,'products','milk')));
 await admin(s=>setDoc(doc(s,'members',users[0]),{schemaVersion:2,uid:users[0],role:'device',status:'revoked',authType:'anonymous'}));
 await assertFails(getDocFromServer(doc(store,'products','milk')));
 await assertFails(emulatorWriter(store,users[0])(add()));
});
test('auth : appareil connu sous fournisseur non anonyme ou mauvais type refusé',async()=>{
 await assertFails(getDocFromServer(doc(db(users[0],'password'),'products','milk')));
 await admin(s=>setDoc(doc(s,'members',users[0]),{schemaVersion:2,uid:users[0],role:'device',status:'active',authType:'password'}));
 await assertFails(getDocFromServer(doc(db(),'products','milk')));
});
test('members : aucune auto-inscription, promotion, modification ni suppression depuis le client',async()=>{
 const record={schemaVersion:1,uid:'outsider',role:'family',status:'active',recoverable:true};
 await assertFails(setDoc(doc(db('outsider'),'members','outsider'),record));
 await assertFails(setDoc(doc(db(),'members','outsider'),record));
 await assertFails(setDoc(doc(db(),'members',users[0]),{...record,uid:users[0],role:'admin'}));
 await assertFails(deleteDoc(doc(db(),'members',users[1])));
});
test('défaut : chemins et sous-collections inconnus refusés',async()=>{
 await assertFails(getDoc(doc(db(),'unknown','x')));
 await assertFails(setDoc(doc(db(),'products','milk','private','x'),{value:1}));
});
test('auteur : usurpation de l’événement ou du document refusée',async()=>{
 const store=db(),before=(await getDoc(doc(store,'products','milk'))).data();
 await assertFails(pair(store,'products','milk',before,{}, {authorUid:users[1]}).batch.commit());
 await assertFails(pair(store,'products','milk',before,{authorUid:users[1]}).batch.commit());
 const forged=pair(store,'products','milk',before,{authorUid:users[1]}, {},users[1]);
 await assertFails(forged.batch.commit());
});
test('produits : champs inconnus, quantités négatives/non entières/hors bornes et unités incorrectes refusés',async()=>{
 const store=db(),before=(await getDoc(doc(store,'products','milk'))).data();
 for(const patch of [{stockMicros:-1},{stockMicros:0.5},{targetMicros:1000000000001},{thresholdMicros:NaN},
  {unit:''},{unit:'   '},{unit:'kg'},{unknown:true},{name:''},{legacy:{injected:'field'}},{createdBy:users[1]}]){
  await assertFails(pair(store,'products','milk',before,patch).batch.commit());
 }
 assert.equal((await getDoc(doc(store,'products','milk'))).data().revision,1);
});
test('produits : création et mise à jour valides gardent ID et unité, archivage sans suppression physique',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);
 await write({operationId:'create-product-001',targetCollection:'products',targetId:'historical-id-kept',expectedRevision:0,action:'product.write',confirmed:true,
  data:{name:'Pain libre',unit:'pièce',stockMicros:0,thresholdMicros:1000000,targetMicros:2000000}});
 await write({operationId:'archive-product-001',targetCollection:'products',targetId:'historical-id-kept',expectedRevision:1,action:'product.write',confirmed:true,data:{deleted:true}});
 assert.equal((await getDoc(doc(store,'products','historical-id-kept'))).data().id,'historical-id-kept');
 await assertFails(deleteDoc(doc(store,'products','historical-id-kept')));
 await assertFails(write({operationId:'revive-product-001',targetCollection:'products',targetId:'historical-id-kept',expectedRevision:2,action:'product.write',confirmed:true,data:{deleted:false}}));
});
test('atomicité : produit seul ou événement seul refusés, sans effet partiel',async()=>{
 const store=db(),before=(await getDoc(doc(store,'products','milk'))).data(),attack=pair(store,'products','milk',before,{stockMicros:0});
 await assertFails(setDoc(doc(store,'products','milk'),attack.after));
 await assertFails(setDoc(doc(store,'operations',attack.operationId),attack.event));
 assert.equal((await getDoc(doc(store,'products','milk'))).data().stockMicros,1000000);
 assert.equal((await getDocs(collection(store,'operations'))).size,0);
});
test('horodatage : heure et confirmation falsifiées refusées',async()=>{
 const store=db(),before=(await getDoc(doc(store,'products','milk'))).data();
 await assertFails(pair(store,'products','milk',before,{}, {createdAt:Timestamp.fromMillis(1)}).batch.commit());
 await assertFails(pair(store,'products','milk',before,{}, {confirmed:false}).batch.commit());
});
test('operations : événement immuable, modification et suppression refusées',async()=>{
 const store=db();await emulatorWriter(store,users[0])(add());
 const reference=doc(store,'operations','operation-add-0001'),event=(await getDoc(reference)).data();
 await assertFails(setDoc(reference,{...event,choice:'set_total'}));await assertFails(deleteDoc(reference));
 assert.deepEqual((await getDoc(reference)).data(),event);
});
test('doublons : 2, 3 ou 5 selon le choix explicite ; pas de choix ni quantité invalide admis',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);
 for(const [choice,total] of [['keep',2000000],['set_total',3000000],['add_extra',5000000]]){
  const command=add({targetId:'free_'+choice+'12345678',productId:null,name:'Essai '+choice,unit:'article',choice});
  // Les résultats 2/3/5 sont contrôlés sur des produits fictifs distincts avec besoin auto 2.
  const id='milk-'+choice;await admin(s=>setDoc(doc(s,'products',id),product(id)));
  await write({...command,operationId:'choose-'+choice+'-0001',targetId:'product_'+id,productId:id});
  assert.equal((await getDoc(doc(store,'shoppingLines','product_'+id))).data().totalMicros,total);
 }
 await assertFails(write(add({choice:'unchanged'})));
 await assertFails(write(add({choice:undefined})));
 await assertFails(write(add({quantityMicros:-1,valueMicros:-1})));
});
test('unités : groupe associé incompatible refusé et article libre accepté sans créer de produit',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);await write(add());const before=await readGroup(store);
 const bad=pair(store,'shoppingLines','product_milk',before,{unit:'bouteilles'});
 await assertFails(bad.batch.commit());
 const free=add({operationId:'free-eggs-operation',targetId:'free_eggs12345678',productId:null,name:'Œufs individuels',unit:'œuf',quantityMicros:12000000,valueMicros:12000000});
 await write(free);assert.equal((await getDocs(collection(store,'products'))).size,1);
 assert.equal((await getDoc(doc(store,'shoppingLines',free.targetId))).data().totalMicros,12000000);
});
test('contributions : suppression silencieuse d’un autre auteur refusée et auteurs originaux conservés',async()=>{
 const store=db();await emulatorWriter(store,users[0])(add());
 await emulatorWriter(db(users[1]),users[1])(add({operationId:'bob-operation-0002',expectedRevision:1,entryId:'bob-contribution-0002',quantityMicros:1000000,valueMicros:1000000}));
 const before=await readGroup(store),changed={...before.contributions};delete changed['bob-contribution-0002'];
 await assertFails(pair(store,'shoppingLines','product_milk',before,{contributions:changed}).batch.commit());
 const saved=await readGroup(store);assert.equal(saved.contributions['bob-contribution-0002'].createdBy,users[1]);
 assert.equal(saved.contributions['contribution-0001'].createdBy,users[0]);
});
test('shopping : coche individuelle, principale et retrait ne modifient jamais les stocks',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);await write(add());
 const inventory=(await getDoc(doc(store,'products','milk'))).data();
 await write(add({operationId:'check-operation-0002',expectedRevision:1,action:'check',choice:'unchanged',valueMicros:0,checked:true}));
 let group=await readGroup(store);assert.equal(group.checks['contribution-0001'],true);assert.equal(group.automaticChecked,false);
 await write(add({operationId:'checkall-operation3',expectedRevision:2,action:'checkAll',entryId:null,choice:'unchanged',valueMicros:0,checked:true}));
 group=await readGroup(store);assert.equal(group.checkAll,true);assert.equal(group.automaticChecked,true);assert.deepEqual(group.checks,{});
 await write(add({operationId:'remove-operation-04',expectedRevision:3,action:'remove',choice:'unchanged',valueMicros:0}));
 group=await readGroup(store);assert.equal(group.needsReview,true);assert.equal(group.totalMicros,5000000);assert.equal(group.contributions['contribution-0001'].status,'removed');
 assert.deepEqual((await getDoc(doc(store,'products','milk'))).data(),inventory);
});
test('total : stock changé, ajout refusé jusqu’au réexamen explicite',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);await write(add({choice:'set_total'}));
 await write({operationId:'change-stock-0002',targetCollection:'products',targetId:'milk',expectedRevision:1,action:'product.write',confirmed:true,data:{stockMicros:0}});
 const command=add({operationId:'after-stock-add02',expectedRevision:1,expectedProductRevision:2,entryId:'contribution-0002'});
 await assertFails(write(command));
 await write(add({operationId:'review-total-0002',expectedRevision:1,expectedProductRevision:2,action:'review',entryId:null,choice:'set_total',valueMicros:4000000}));
 assert.equal((await readGroup(store)).totalMicros,4000000);
 await write({...command,expectedRevision:2});assert.equal((await readGroup(store)).totalMicros,7000000);
});
test('révisions : écriture obsolète, saut ou réutilisation d’un événement refusés',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);await write(add());const before=await readGroup(store);
 await assert.rejects(write(add({operationId:'stale-add-operation',entryId:'new-entry-0002'})),/preview-obsolete/);
 await assertFails(pair(store,'shoppingLines','product_milk',before,{revision:100}).batch.commit());
 const event=(await getDoc(doc(store,'operations','operation-add-0001'))).data();
 await assertFails(setDoc(doc(store,'operations',event.id),event));
 assert.equal((await readGroup(store)).revision,1);
});
test('rejeu : validation identique idempotente, contenu différent au même ID refusé',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]),command=add();
 const first=await write(command),second=await write(command);assert.equal(first.replayed,false);assert.equal(second.replayed,true);
 await assert.rejects(write({...command,valueMicros:4000000}),/replay-mismatch/);
 assert.equal((await getDocs(collection(store,'operations'))).size,1);assert.equal((await readGroup(store)).revision,1);
});
test('concurrence : deux contributions, un conflit explicite puis confirmation nouvelle, aucun écrasement',async()=>{
 const alice=db(),bob=db(users[1]),a=emulatorWriter(alice,users[0]),b=emulatorWriter(bob,users[1]);
 const commands=[add(),add({operationId:'concurrent-bob-0002',entryId:'contribution-bob-02',quantityMicros:1000000,valueMicros:1000000})];
 const results=await Promise.allSettled([a(commands[0]),b(commands[1])]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const loser=results.findIndex(r=>r.status==='rejected');assert.equal(results[loser].reason.code,'sync-conflict');
 let group=await readGroup(alice);assert.equal(Object.keys(group.contributions).length,1);
 // Représente une nouvelle prévisualisation puis confirmation humaine explicite.
 await [a,b][loser]({...commands[loser],expectedRevision:1,confirmed:true});
 group=await readGroup(alice);assert.equal(Object.keys(group.contributions).length,2);assert.equal(group.totalMicros,6000000);
 const events=await getDocs(collection(alice,'operations'));assert.equal(events.size,2);
 for(const command of commands)assert.ok(events.docs.some(d=>d.id===command.operationId));
});
test('concurrence : décision de total concurrente à un ajout, aucune décision ni contribution perdue',async()=>{
 const store=db(),a=emulatorWriter(store,users[0]),b=emulatorWriter(db(users[1]),users[1]);await a(add());
 const original=(await getDoc(doc(store,'operations','operation-add-0001'))).data();
 const review=add({operationId:'concurrent-review-02',expectedRevision:1,action:'review',entryId:null,choice:'set_total',valueMicros:4000000});
 const extra=add({operationId:'concurrent-extra-003',expectedRevision:1,entryId:'contribution-extra03',quantityMicros:1000000,valueMicros:1000000});
 const results=await Promise.allSettled([a(review),b(extra)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal(results.find(r=>r.status==='rejected').reason.code,'sync-conflict');
 assert.deepEqual((await getDoc(doc(store,'operations','operation-add-0001'))).data(),original);
 assert.equal((await getDocs(collection(store,'operations'))).size,2);
 const group=await readGroup(store);assert.ok(group.contributions['contribution-0001']);
 assert.equal(group.revision,2);
});
test('calcul historique : seuil décimal IEEE-754 conservé, suggestions et unités exactes',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);
 const fixtures=[product('edge',{stockMicros:900000,thresholdMicros:600000,targetMicros:2000000}),
  product('suggested',{stockMicros:4000000,targetMicros:6000000,frequency:'hebdomadaire',lastRestocked:Timestamp.fromMillis(1)})];
 for(const p of fixtures){
  await admin(s=>setDoc(doc(s,'products',p.id),p));
  await write(add({operationId:'historical-'+p.id+'-operation',targetId:'product_'+p.id,productId:p.id}));
  assert.equal((await getDoc(doc(store,'shoppingLines','product_'+p.id))).data().totalMicros,autoMicros(p)+3000000);
 }
 assert.equal(autoMicros(fixtures[0]),0);assert.equal(toMicros('0,1'),100000);assert.throws(()=>toMicros('0.1234567'),/precision/);
});
test('isolement : projet ou hôte distant refusés avant toute requête',()=>{
 assert.throws(()=>assertEmulator({app:{options:{projectId:'not-the-demo'}},_settings:{host:EMULATOR,ssl:false}}),/EMULATOR_ONLY/);
 assert.throws(()=>assertEmulator({app:{options:{projectId:PROJECT}},_settings:{host:'remote.invalid',ssl:true}}),/EMULATOR_ONLY/);
 assert.throws(()=>fetch('https://example.invalid/'),/TEST_NETWORK_GUARD/);
});
test('archives : archive administrative lisible, aucune création, modification ou suppression cliente',async()=>{
 const archive={schemaVersion:1,kind:'migration.archive',sourceHash:'b'.repeat(64),partIndex:0,partCount:1,payload:'ZmljdGlm',administrativeAuthorUid:'fixture-admin'};
 await admin(s=>setDoc(doc(s,'operations','migration-fixture-archive'),archive));
 const store=db();await assertSucceeds(getDoc(doc(store,'operations','migration-fixture-archive')));
 await assertFails(setDoc(doc(store,'operations','migration-forged-archive'),archive));
 await assertFails(setDoc(doc(store,'operations','migration-fixture-archive'),{...archive,payload:'bad'}));
 await assertFails(deleteDoc(doc(store,'operations','migration-fixture-archive')));
});
test('borne : édition valide de 100 contributions préserve les 99 autres, ajout 101 refusé',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);await write(add());
 const group=await readGroup(store);
 for(let n=1;n<100;n++){const id='bounded-entry-'+String(n).padStart(3,'0');group.contributions[id]={id,revision:1,quantityMicros:1000000,status:'active',createdBy:users[1],authorUid:users[1]};group.checks[id]=false;}
 await admin(s=>setDoc(doc(s,'shoppingLines','product_milk'),group));
 await write(add({operationId:'bounded-edit-0002',expectedRevision:1,action:'edit',choice:'set_total',quantityMicros:2000000,valueMicros:4000000}));
 let after=await readGroup(store);assert.equal(Object.keys(after.contributions).length,100);
 for(let n=1;n<100;n++){const id='bounded-entry-'+String(n).padStart(3,'0');assert.deepEqual(after.contributions[id],group.contributions[id]);}
 await assertFails(write(add({operationId:'bounded-add-10101',expectedRevision:2,entryId:'bounded-entry-101'})));
 after=await readGroup(store);assert.equal(after.revision,2);assert.equal((await getDocs(collection(store,'operations'))).size,2);
});
test('rejeu concurrent : même validation deux fois, un seul événement et une seule contribution',async()=>{
 const store=db(),a=emulatorWriter(store,users[0]),b=emulatorWriter(db(),users[0]);
 const results=await Promise.all([a(add()),b(add())]);assert.equal(results.filter(r=>r.replayed).length,1);
 assert.equal((await getDocs(collection(store,'operations'))).size,1);assert.equal((await readGroup(store)).revision,1);
});
test('concurrence : groupes distincts indépendants, les deux écritures sont conservées',async()=>{
 const a=db(),b=db(users[1]);
 await Promise.all([emulatorWriter(a,users[0])(add({operationId:'independent-a-001',targetId:'free_independentA',productId:null,name:'Pain',unit:'article'})),
  emulatorWriter(b,users[1])(add({operationId:'independent-b-001',targetId:'free_independentB',productId:null,name:'Riz',unit:'kg'}))]);
 assert.equal((await getDocs(collection(a,'shoppingLines'))).size,2);assert.equal((await getDocs(collection(a,'operations'))).size,2);
});
test('concurrence : stock et décision, conflit explicite ou total immédiatement périmé, jamais acquitté silencieusement',async()=>{
 const store=db(),a=emulatorWriter(store,users[0]),b=emulatorWriter(db(users[1]),users[1]);await a(add());
 const results=await Promise.allSettled([
  a({operationId:'concurrent-stock-02',targetCollection:'products',targetId:'milk',expectedRevision:1,action:'product.write',confirmed:true,data:{stockMicros:0}}),
  b(add({operationId:'concurrent-review02',expectedRevision:1,action:'review',entryId:null,choice:'set_total',valueMicros:4000000}))]);
 assert.equal(results[0].status,'fulfilled');
 if(results[1].status==='rejected')assert.equal(results[1].reason.code,'sync-conflict');
 const group=await readGroup(store),p=(await getDocFromServer(doc(store,'products','milk'))).data();
 assert.equal(p.revision,2);assert.equal(group.productRevision,1);assert.equal(groupNeedsReview(group,p),true);
 assert.ok(group.contributions['contribution-0001']);
});
test('concurrence : deux décisions de total ne peuvent s’écraser',async()=>{
 const store=db(),a=emulatorWriter(store,users[0]),b=emulatorWriter(db(users[1]),users[1]);await a(add({choice:'set_total'}));
 const command=add({expectedRevision:1,action:'review',entryId:null,choice:'set_total'});
 const results=await Promise.allSettled([a({...command,operationId:'decision-alice-0002',valueMicros:4000000}),b({...command,operationId:'decision-bob-00002',valueMicros:6000000})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'sync-conflict');
 assert.ok([4000000,6000000].includes((await readGroup(store)).totalMicros));
 assert.equal((await getDocs(collection(store,'operations'))).size,2);
 assert.ok((await getDoc(doc(store,'operations','operation-add-0001'))).exists());
});
test('reconnexion après acquittement perdu : nouveau client, commande persistée fictive, aucun double effet',async()=>{
 const command=add(),pending=JSON.stringify(command);await emulatorWriter(db(),users[0])(command);
 // Le résultat du premier client est volontairement oublié ; le nouveau client
 // relit l'événement au serveur, sans dépendre d'un cache du précédent client.
 const fresh=db(),result=await emulatorWriter(fresh,users[0])(JSON.parse(pending));
 assert.equal(result.replayed,true);assert.equal((await getDocs(collection(fresh,'operations'))).size,1);
 assert.equal((await readGroup(fresh)).totalMicros,5000000);assert.equal((await readGroup(fresh)).revision,1);
});
test('réexamen : nouveau stock ne récupère pas une ancienne coche automatique, coches manuelles préservées',async()=>{
 const store=db(),write=emulatorWriter(store,users[0]);await write(add({choice:'set_total'}));
 await write(add({operationId:'all-checked-before-stock',expectedRevision:1,action:'checkAll',entryId:null,choice:'unchanged',valueMicros:0,checked:true}));
 await write({operationId:'stock-for-check-review',targetCollection:'products',targetId:'milk',expectedRevision:1,action:'product.write',confirmed:true,data:{stockMicros:0}});
 await write(add({operationId:'quantity-check-review',expectedRevision:2,expectedProductRevision:2,action:'review',entryId:null,choice:'set_total',valueMicros:4000000}));
 const group=await readGroup(store);assert.equal(group.automaticChecked,false);assert.equal(group.checkAll,true);assert.deepEqual(group.checks,{});
 assert.equal(group.totalMicros,4000000);assert.equal(group.productRevision,2);
});
