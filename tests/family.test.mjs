import test from 'node:test';import assert from 'node:assert/strict';
import {fresh,enqueue,claim,settle,classify,exportBackup,planRestore,retry,spend} from '../src/family/state.js';
import {memoryStore} from '../src/family/store.js';import {familyEngine} from '../src/family/engine.js';
import {rows,addition,textList} from '../src/family/domain.js';import {parseList} from '../src/shopping/domain.js';
const uid='family-alice',p={schemaVersion:2,id:'milk',revision:1,name:'Lait',unit:'L',stockMicros:1000000,thresholdMicros:1000000,targetMicros:3000000,frequency:'',lastRestocked:null,deleted:false};
const cache={products:[p],groups:[]};
const cmd=(o={})=>({actorUid:uid,operationId:'operation-family-0001',targetCollection:'products',targetId:'milk',expectedRevision:1,action:'product.write',confirmed:true,data:{stockMicros:0},...o});
test('famille : persistance avant envoi, échec du stockage ne produit aucune écriture',async()=>{
 let writes=0;const store={read:async()=>fresh(uid),mutate:async()=>{throw Error('disk-full');}};const engine=familyEngine({uid,store,transport:{write:async()=>writes++},online:()=>true});await assert.rejects(engine.submit([cmd()]));assert.equal(writes,0);await engine.close();
});
test('famille : identité stable, même validation idempotente, contenu changé refusé',()=>{
 const s=enqueue(fresh(uid),[cmd(),cmd()]);assert.equal(s.outbox.length,1);assert.throws(()=>enqueue(s,[cmd({data:{stockMicros:4}})]),/identity-conflict/);assert.equal(s.outbox[0].command.data.stockMicros,0);
});
test('famille : bail interonglets, reprise après crash avec le même identifiant',()=>{
 const s=enqueue(fresh(uid),[cmd()]),a=claim(s,'a',100),b=claim(a.state,'b',200);assert.equal(b.item,null);const c=claim(a.state,'b',30200);assert.equal(c.item.command.operationId,cmd().operationId);assert.equal(c.item.owner,'b');
});
test('famille : conflit bloquant, aucune intention suivante ne le dépasse',()=>{
 let s=enqueue(fresh(uid),[cmd(),cmd({operationId:'operation-family-0002'})]);s=claim(s,'a',0).state;s=settle(s,cmd().operationId,'conflict','a');assert.equal(claim(s,'a',40000).item,null);assert.throws(()=>retry(s,cmd().operationId),/repreview/);
});
test('famille : erreurs quota/révocation/réseau/conflit distinguées sans effacement',()=>{
 for(const [code,status] of [['resource-exhausted','quota'],['permission-denied','revoked'],['unavailable','pending'],['sync-conflict','conflict'],['auth/network-request-failed','pending'],['auth/too-many-requests','quota']])assert.equal(classify({code}),status);
 const s=enqueue(fresh(uid),[cmd()]);assert.equal(s.outbox.length,1);
});
test('famille : budget conservateur, aucune offre payante ni effacement automatique',()=>{
 const s=spend(fresh(uid),10000,1000,Date.now());assert.throws(()=>spend(s,1,0),/local-budget/);assert.equal(s.budget.writes,1000);assert.equal(spend(s,1,1,s.budget.since+86400000).budget.writes,1);
});
test('famille : sauvegarde/restauration idempotente, snapshots existants conservés',()=>{
 const incoming=enqueue(fresh(uid),[cmd()]);incoming.cache=cache;const existing=fresh(uid);existing.cache={products:[{...p,revision:5}],groups:[]};const first=planRestore(existing,exportBackup(incoming));assert.equal(first.added.length,1);assert.equal(first.next.outbox[0].status,'held');assert.equal(first.next.cache.products[0].revision,5);assert.equal(planRestore(first.next,exportBackup(incoming)).added.length,0);
});
test('famille : restauration conflictuelle refusée sans mutation et format/UID vérifiés',()=>{
 const a=enqueue(fresh(uid),[cmd()]),b=enqueue(fresh(uid),[cmd({data:{stockMicros:8}})]),before=structuredClone(a);assert.equal(planRestore(a,exportBackup(b)).conflicts.length,1);assert.deepEqual(a,before);
 for(const file of [{version:2},exportBackup(fresh('family-bob')),{...exportBackup(a),version:9}])assert.throws(()=>planRestore(a,file));
});
test('famille : pas de transfert des opérations d’un autre auteur',()=>{assert.throws(()=>enqueue(fresh(uid),[cmd({actorUid:'family-bob'})]),/invalid-command/);});
test('famille : sources et coches mixtes séparées, le stock reste inchangé',()=>{
 const g={id:'product_milk',productId:'milk',name:'Lait',unit:'L',revision:1,productRevision:1,automaticMicros:2000000,totalMicros:5000000,needsReview:false,automaticChecked:true,checkAll:false,checks:{},contributions:{c:{id:'c',status:'active',quantityMicros:3000000}}};const c={products:[p],groups:[g]},before=structuredClone(c);const row=rows(c)[0];assert.equal(row.mixed,true);assert.equal(row.checked,false);assert.equal(row.totalMicros,5000000);assert.deepEqual(c,before);
});
test('famille : stock changé, total marqué à revérifier en FR/DE et conservé',()=>{
 const g={id:'product_milk',productId:'milk',name:'Lait',unit:'L',revision:1,productRevision:1,automaticMicros:2000000,totalMicros:3000000,contributions:{},checks:{},checkAll:false,automaticChecked:false};const c={products:[{...p,revision:2,stockMicros:0}],groups:[g]};assert.equal(rows(c)[0].review,true);assert.match(textList(c,'fr'),/3 L.*revérifier/);assert.match(textList(c,'de'),/3 L.*prüfen/);
});
test('famille : doublon 2 + proposition 3, uniquement choix explicites 2/3/5',async()=>{
 const row=parseList('lait x3',[{id:'milk',name:'Lait',unit:'L'}])[0];await assert.rejects(addition(uid,row,cache),/explicit-duplicate/);
 for(const [choice,want] of [['keep',2],['set_total',3],['add_extra',5]]){const c=await addition(uid,row,cache,choice);const actual=c.choice==='keep'?2:c.choice==='set_total'?c.valueMicros/1e6:2+c.valueMicros/1e6;assert.equal(actual,want);}
 assert.equal(p.stockMicros,1000000);
});
test('famille : unités incompatibles refusées, article libre stable et aucune création produit',async()=>{
 const row=parseList('lait 2 L',[{id:'milk',name:'Lait',unit:'L'}])[0];row.unit='boîte';await assert.rejects(addition(uid,row,cache,'add_extra'),e=>e.code==='units');row.productId=null;const a=await addition(uid,row,cache),b=await addition(uid,row,cache);assert.equal(a.targetId,b.targetId);assert.equal(a.targetCollection,'shoppingLines');
});
test('famille : transaction locale CAS détecte une restauration interonglets obsolète',async()=>{
 const s=memoryStore(),old=await s.read(uid);await s.mutate(uid,s=>enqueue(s,[cmd()]));await assert.rejects(s.mutate(uid,()=>old,old.revision),e=>e.code==='sync-conflict');assert.equal((await s.read(uid)).outbox.length,1);
});
test('famille : perte de réseau et acquittement perdu, reprise du même ID sans double effet',async()=>{
 const s=memoryStore(),applied=new Set();let first=true,network=false,writes=0;const listeners=[];const transport={member:async()=>{},watch:(kind,cb)=>{listeners.push([kind,cb]);return ()=>{};},write:async c=>{writes++;applied.add(c.operationId);if(first){first=false;throw {code:'unavailable'};}}};
 const e=familyEngine({uid,store:s,transport,online:()=>network});try{await e.start();await e.submit([cmd()]);assert.equal(writes,0);assert.equal((await s.read(uid)).outbox[0].status,'pending');network=true;await e.flush();assert.equal(applied.size,1);assert.equal((await s.read(uid)).outbox[0].status,'pending');await e.flush();assert.equal(applied.size,1);assert.equal(writes,2);assert.equal((await s.read(uid)).outbox[0].status,'ack');}finally{await e.close();}
});
test('famille : quota en cours d’envoi conserve la file et bloque les suivantes',async()=>{
 const s=memoryStore();let writes=0;const e=familyEngine({uid,store:s,transport:{member:async()=>{},watch:()=>()=>{},write:async()=>{writes++;throw {code:'resource-exhausted'};}},online:()=>true});try{await e.start();await e.submit([cmd(),cmd({operationId:'operation-family-0002'})]);const state=await s.read(uid);assert.equal(state.outbox[0].status,'quota');assert.equal(state.outbox[1].status,'pending');assert.equal(writes,1);assert.equal(e.authorized,false);}finally{await e.close();}
});
test('famille : trois abonnements au plus, jamais au journal et aucun au changement de vue',async()=>{
 const s=memoryStore(),watched=[],stopped=[];const e=familyEngine({uid,store:s,transport:{member:async()=>{},watch:k=>{watched.push(k);return()=>stopped.push(k);}},online:()=>true});await e.start();assert.deepEqual(watched,['member','products','groups']);await e.reload();assert.equal(watched.length,3);await e.close();assert.equal(stopped.length,3);
});
test('famille : commande restaurée invalide et budgets corrompus refusés avant tout envoi',()=>{
 const file=exportBackup(enqueue(fresh(uid),[cmd()]));file.state.outbox[0].command.data.stockMicros=-1;assert.throws(()=>planRestore(fresh(uid),file),/invalid-command/);
 const other=exportBackup(fresh(uid));other.state.budget.reads=-1;assert.throws(()=>planRestore(fresh(uid),other),/invalid-backup/);
});
test('famille : article libre même nom g/kg rapproché, doublon confirmé et unité conservée',async()=>{
 const g={id:'free_pommes123',productId:null,name:'Pommes',unit:'kg',revision:2,totalMicros:2000000,automaticMicros:0,productRevision:0,needsReview:false};const c={products:[],groups:[g]},r=parseList('pommes 500 g')[0];await assert.rejects(addition(uid,r,c),/explicit-duplicate/);const command=await addition(uid,r,c,'add_extra');assert.equal(command.targetId,g.id);assert.equal(command.valueMicros,500000);assert.equal(command.unit,'kg');r.unit='boîte';await assert.rejects(addition(uid,r,c,'add_extra'),/clarification/);r.distinctFree=true;const distinct=await addition(uid,r,c);assert.notEqual(distinct.targetId,g.id);
});
test('famille : snapshot ancien ou non confirmé ne remplace pas le stock confirmé',async()=>{
 const s=memoryStore();await s.mutate(uid,s=>({...s,cache:{products:[{...p,revision:3}],groups:[]}}));const callbacks={};const e=familyEngine({uid,store:s,transport:{member:async()=>{},watch:(kind,cb)=>{callbacks[kind]=cb;return()=>{};}},online:()=>true});try{await e.start();await callbacks.products([{...p,revision:2}],{fromCache:true});assert.equal((await s.read(uid)).cache.products[0].revision,3);await callbacks.products([{...p,revision:4}],{fromCache:false,hasPendingWrites:true});assert.equal((await s.read(uid)).cache.products[0].revision,3);}finally{await e.close();}
});
test('famille : après révocation, reprendre le même ID exige un nouvel accès et ne perd pas un acquittement inconnu',()=>{
 let s=enqueue(fresh(uid),[cmd()]);s=claim(s,'a',0).state;s=settle(s,cmd().operationId,'revoked','a');const next=retry(s,cmd().operationId);assert.equal(next.outbox[0].command.operationId,cmd().operationId);assert.equal(next.outbox[0].status,'pending');
});
test('compensation : même reçu, choix ou valeur différent ne peut être annoncé comme le même résultat',async()=>{
 const {sameCompensationDecision}=await import('../security/src/compensation.mjs');const c={action:'undoPurchase',targetCollection:'products',targetId:'milk',compensates:'purchase-0001',expectedRevision:2,expectedGroupRevision:2,valueMicros:1e6,choice:'keep',choiceValueMicros:0};const event={...c,beforeRevision:2,receipt:{compensates:c.compensates,choiceValueMicros:0,groupBeforeRevision:2}};
 assert.equal(sameCompensationDecision(event,c),true);assert.equal(sameCompensationDecision(event,{...c,expectedRevision:3}),false);assert.equal(sameCompensationDecision(event,{...c,choice:'add_extra',choiceValueMicros:1e6}),false);assert.equal(sameCompensationDecision({...event,choice:'set_total'}, {...c,choice:'set_total',choiceValueMicros:3e6}),false);assert.equal(sameCompensationDecision(event,{...c,targetId:'other'}),false);
});
test('appareil : UID généré accepté, autorisation locale v2 hors ligne et absence de transfert d’identité',async()=>{
 const {validUid}=await import('../src/family/state.js');assert.equal(validUid('FictionalUidGenerated0000001'),true);assert.equal(validUid('invalid/uid'),false);
 const s=memoryStore();await s.mutate(uid,s=>({...s,lastAuthorization:{uid,policy:'anonymous-device-v2',verifiedAt:1},cache:{products:[p],groups:[]}}));const engine=familyEngine({uid,store:s,online:()=>false,transport:{member:async()=>{throw Error('must-not-contact-server');},observeMembership:()=>()=>{}}});try{await engine.start();assert.equal(engine.authorized,true);await engine.submit([cmd()]);assert.equal((await s.read(uid)).outbox[0].status,'pending');}finally{await engine.close();}
 const b=familyEngine({uid:'new-device-fictitious',store:s,online:()=>false,transport:{member:async()=>{throw {code:'unavailable'};},observeMembership:()=>()=>{}}});try{await b.start();assert.equal(b.authorized,false);}finally{await b.close();}
});
test('perte d’identité : aucun transfert d’auteur ; audit du reçu avant toute ressaisie',async()=>{
 const {auditIdentityBackup}=await import('../src/family/recovery.js');const {digest}=await import('../security/src/contracts.mjs');const file=exportBackup(enqueue(fresh(uid),[cmd()])),newUid='new-anonymous-device';assert.throws(()=>planRestore(fresh(newUid),file),/identity-mismatch/);
 const unknown=await auditIdentityBackup(file,newUid);assert.equal(unknown.outcomes[0].status,'manual-review-required');assert.deepEqual(unknown.changes,[]);assert.equal(unknown.outcomes[0].canAutoReplay,false);
 const event={id:cmd().operationId,authorUid:uid,requestHash:await digest({...cmd(),eventVersion:2})};assert.equal((await auditIdentityBackup(file,newUid,[event])).outcomes[0].status,'server-received');assert.equal((await auditIdentityBackup(file,newUid,[{...event,authorUid:newUid}])).outcomes[0].status,'operation-identity-conflict');assert.equal(file.state.outbox[0].command.actorUid,uid);
});
test('appareil : un seul suivi de statut avant autorisation, aucun abonnement aux données puis révocation du cache local',async()=>{
 const s=memoryStore();let statusCallback,permitted=false,stops=0;const watched=[];const e=familyEngine({uid,store:s,online:()=>true,transport:{observeMembership:fn=>{statusCallback=fn;return()=>stops++;},member:async()=>{if(!permitted)throw {code:'device-pending'};},watch:k=>{watched.push(k);return()=>stops++;}}});
 try{await e.start();assert.equal(e.authorized,false);assert.deepEqual(watched,[]);permitted=true;await statusCallback({schemaVersion:2,uid,role:'device',authType:'anonymous',status:'active'});assert.equal(e.authorized,true);assert.deepEqual(watched,['products','groups']);assert.equal((await s.read(uid)).lastAuthorization.uid,uid);await statusCallback({status:'revoked'});assert.equal(e.authorized,false);assert.equal((await s.read(uid)).lastAuthorization,null);}finally{await e.close();}assert.equal(stops,3);
});
test('appareil : Synchronisé seulement après réception des deux snapshots serveur',async()=>{
 const s=memoryStore(),callbacks={},reasons=[];const e=familyEngine({uid,store:s,changed:(_,why)=>{if(why!==undefined)reasons.push(why);},online:()=>true,transport:{member:async()=>{},watch:(k,fn)=>{callbacks[k]=fn;return()=>{};}}});try{await e.start();await callbacks.products([p],{fromCache:false});assert.equal(reasons.at(-1),'connecting');await callbacks.groups([],{fromCache:false});assert.equal(reasons.at(-1),null);}finally{await e.close();}
});
