import test from 'node:test';import assert from 'node:assert/strict';
import {fresh,enqueueQuick,enqueueQuickBatch,validateState,exportBackup,planRestore} from '../src/family/state.js';
import {quickIntent,quickView,quickBuffer,quickReviewPlan,applyQuickReview} from '../src/family/quick-stock.js';
import {quickWords,quickFeedback} from '../src/family/quick-stock-text.js';
import {fixtureData,fixtureApply} from '../src/mobile/reducer.js';
import {familyEngine} from '../src/family/engine.js';import {memoryStore} from '../src/family/store.js';
const uid='quick-test',id=()=>crypto.randomUUID(),initial=(stock=1e6)=>({...fresh(uid),cache:{products:[{...fixtureData().products[0],stockMicros:stock}],groups:[]}});
const add=(s,d)=>enqueueQuick(s,quickIntent(s,'milk',d,id()));
test('7.1 : + et − sont des corrections de stock seules, révision explicite et confirmation par appui',()=>{
 const s=initial(),before=structuredClone(s),plus=quickIntent(s,'milk',1,id()),minus=quickIntent(s,'milk',-1,id());assert.equal(plus.command.data.stockMicros,2e6);assert.equal(minus.command.data.stockMicros,0);assert.equal(plus.command.expectedRevision,1);assert.equal(plus.command.confirmed,true);assert.deepEqual(Object.keys(plus.command.data),['stockMicros']);assert.deepEqual(s,before);
});
test('7.1 : zéro ne produit aucune écriture ; décimales sans quantité négative ni conversion d’unité',()=>{
 assert.equal(quickIntent(initial(0),'milk',-1,id()),null);const c=quickIntent(initial(500000),'milk',-1,id());assert.equal(c.command.data.stockMicros,0);assert.equal(c.quickStock.unit,'L');assert.throws(()=>quickIntent(initial(1e12),'milk',1,id()),/quantity-range/);
});
test('7.1 : 40 appuis rapides, 40 ID et révisions en chaîne, sans toucher au cache confirmé',()=>{
 let s=initial();const before=structuredClone(s.cache);for(let i=0;i<40;i++)s=add(s,1);assert.equal(new Set(s.outbox.map(i=>i.command.operationId)).size,40);assert.deepEqual(s.outbox.map(i=>i.command.expectedRevision),Array.from({length:40},(_,i)=>i+1));assert.equal(quickView(s,'milk').displayMicros,41e6);assert.deepEqual(s.cache,before);
});
test('7.1 : ordre +/− conservé, bornage à zéro à chaque geste',()=>{
 let s=initial(0);for(const delta of [1,-1,1,1,-1,-1])s=add(s,delta);assert.equal(quickView(s,'milk').displayMicros,0);assert.equal(s.outbox.length,6);assert.equal(quickIntent(s,'milk',-1,id()),null);
});
test('7.1 : retour visuel synchrone avant stockage ; la persistance ne dépend pas du réseau',async()=>{
 let s=initial(),release;const gate=new Promise(r=>release=r);let calls=0;const b=quickBuffer({getState:()=>s,persist:async batch=>{calls++;await gate;s=enqueueQuickBatch(s,batch);},flush:()=>new Promise(()=>{})});const ids=Array.from({length:30},id),p=ids.map(op=>b.capture('milk',1,op));assert.equal(quickView(s,'milk',b.volatile).displayMicros,31e6);assert.equal(s.outbox.length,0);assert.equal(quickView(s,'milk',b.volatile).saving,true);release();await Promise.all(p);assert.equal(s.outbox.length,30);assert.ok(calls<=2);assert.deepEqual(s.outbox.map(i=>i.command.operationId),ids);assert.equal(b.volatile.length,0);
});
test('7.1 : erreur disque, appuis gardés en mémoire et reprise avec les mêmes ID sans doublon',async()=>{
 let s=initial(),fail=true;const notices=[];const ids=Array.from({length:12},id);const b=quickBuffer({getState:()=>s,persist:async batch=>{if(fail)throw Error('disk-full');s=enqueueQuickBatch(s,batch);},flush:async()=>{throw Error('read-failed')},changed:n=>notices.push(n)});const settled=Promise.allSettled(ids.map(op=>b.capture('milk',1,op)));await settled;assert.equal(s.outbox.length,0);assert.equal(b.volatile.length,12);assert.equal(quickView(s,'milk',b.volatile).blocked,'storage');assert.throws(()=>b.capture('milk',1,id()),/quick-storage/);fail=false;b.retry();for(let i=0;i<20&&b.volatile.length;i++)await new Promise(r=>setTimeout(r,0));assert.equal(s.outbox.length,12);assert.deepEqual(s.outbox.map(i=>i.command.operationId),ids);assert.equal(quickView(s,'milk').displayMicros,13e6);await new Promise(r=>setTimeout(r,0));assert.ok(notices.includes('flush-error'));assert.equal(s.outbox.length,12);
});
test('7.1 : ack avant snapshot, snapshot avant ack : ni retour visuel en arrière ni double projection',()=>{
 let s=add(initial(),1),first=s.outbox[0];first.status='ack';assert.equal(quickView(s,'milk').displayMicros,2e6);s=add(s,1);s.cache.products[0]={...s.cache.products[0],revision:2,stockMicros:2e6,lastOperationId:first.command.operationId};assert.equal(quickView(s,'milk').displayMicros,3e6);s.cache.products[0]={...s.cache.products[0],revision:3,stockMicros:3e6,lastOperationId:s.outbox[1].command.operationId};assert.equal(quickView(s,'milk').blocked,null);assert.equal(quickView(s,'milk').displayMicros,3e6);s.outbox[1].status='ack';assert.equal(quickView(s,'milk').pending,0);
});
test('7.1 : modification concurrente, stock confirmé affiché et appuis conservés pour décision',()=>{
 let s=add(add(initial(),1),1);s.outbox[0].status='conflict';s.cache.products[0]={...s.cache.products[0],revision:2,stockMicros:9e6,lastOperationId:'other-operation'};const v=quickView(s,'milk');assert.equal(v.blocked,'conflict');assert.equal(v.displayMicros,9e6);assert.equal(v.count,2);assert.throws(()=>quickIntent(s,'milk',1,id()),/quick-review-required/);
});
test('7.1 : réexamen explicite, ancienne chaîne archivée et nouvelle correction idempotente',()=>{
 let s=add(add(initial(),1),1);s.outbox[0].status='conflict';const p={...s.cache.products[0],revision:2,stockMicros:9e6,lastOperationId:'other-operation'},before=structuredClone(s),op=id(),plan=quickReviewPlan(s,'milk',p,[],op);assert.equal(plan.totalMicros,11e6);assert.deepEqual(s,before);const next=applyQuickReview(s,plan);validateState(next);assert.deepEqual(next.outbox.slice(0,2).map(i=>i.status),['cancelled','cancelled']);assert.equal(next.outbox[2].command.operationId,op);assert.equal(next.outbox[2].command.expectedRevision,2);assert.equal(next.outbox[2].quickStock.steps.length,2);assert.equal(quickView(next,'milk').displayMicros,11e6);assert.throws(()=>applyQuickReview(next,plan),/quick-review-stale/);assert.deepEqual(next.outbox.slice(0,2).map(i=>i.command),before.outbox.map(i=>i.command));
});
test('7.1 : garder le stock est une décision explicite sans nouvelle écriture',()=>{
 const s=add(initial(),1);s.outbox[0].status='conflict';const p={...s.cache.products[0],revision:2,stockMicros:5e6};const plan=quickReviewPlan(s,'milk',p,[],id()),next=applyQuickReview(s,plan,true);assert.equal(next.outbox.length,1);assert.equal(next.outbox[0].status,'cancelled');assert.equal(next.cache.products[0].stockMicros,5e6);
});
test('7.1 : reçu retrouvé après réponse perdue/restauration, appui déjà appliqué non rejoué',()=>{
 let s=add(add(initial(),1),1);for(const i of s.outbox)i.status='held';const known=s.outbox[0].command.operationId,p={...s.cache.products[0],revision:2,stockMicros:2e6,lastOperationId:known};const plan=quickReviewPlan(s,'milk',p,[known],id()),next=applyQuickReview(s,plan);assert.equal(plan.count,1);assert.equal(plan.totalMicros,3e6);assert.equal(next.outbox[0].status,'ack');assert.equal(next.outbox[2].quickStock.steps.length,1);
});
test('7.1 : plan périmé refusé, pas d’annulation d’une opération encore en vol',()=>{
 const s=add(initial(),1);s.outbox[0].status='sending';assert.throws(()=>quickReviewPlan(s,'milk',s.cache.products[0],[],id()));s.outbox[0].status='conflict';const plan=quickReviewPlan(s,'milk',s.cache.products[0],[],id());const changed=structuredClone(s);changed.cache.products[0].revision++;assert.throws(()=>applyQuickReview(changed,plan),/quick-review-stale/);
});
test('7.1 : archivage ou unité changée, seul abandon explicite possible sans conversion',()=>{
 for(const changes of [{deleted:true},{unit:'boîte'}]){const s=add(initial(),1);s.outbox[0].status='conflict';const p={...s.cache.products[0],revision:2,...changes},plan=quickReviewPlan(s,'milk',p,[],id());assert.ok(plan.blocked);assert.throws(()=>applyQuickReview(s,plan));assert.equal(applyQuickReview(s,plan,true).outbox[0].status,'cancelled');}
});
test('7.1 : métadonnées invalides refusées ; sauvegarde compatible avec mise en attente de revue',()=>{
 const s=add(initial(),1);for(const edit of [q=>q.steps=[0],q=>q.beforeStockMicros=-1,q=>q.steps=[-1e6],q=>q.unit='',q=>q.version=9]){const bad=structuredClone(s);edit(bad.outbox[0].quickStock);assert.throws(()=>validateState(bad));}
 const restored=planRestore(initial(),JSON.parse(JSON.stringify(exportBackup(s))));assert.equal(restored.next.outbox[0].status,'held');assert.deepEqual(restored.next.outbox[0].quickStock,s.outbox[0].quickStock);assert.equal(quickView(restored.next,'milk').blocked,'held');
});
test('7.1 : une autre correction produit en attente n’est pas dépassée par un appui',()=>{
 const s=initial();s.outbox.push({command:{...quickIntent(s,'milk',1,id()).command},status:'pending'});assert.throws(()=>quickIntent(s,'milk',1,id()),/quick-review-required/);
});
test('7.1 : réseau perdu et reçu perdu, même ID repris par le moteur existant sans double stock',async()=>{
 const store=memoryStore();await store.mutate(uid,()=>initial());let remote={...fixtureData(),status:'active'},online=false,lose=true,writes=0;
 const transport={member:async()=>{},watch:()=>()=>{},write:async c=>{writes++;remote=fixtureApply(remote,c,uid,c.operationId);if(lose){lose=false;throw {code:'unavailable'};}}};
 const e=familyEngine({uid,store,transport,online:()=>online});try{await e.start();const b=quickBuffer({getState:()=>e.state,persist:batch=>e.mutate(s=>enqueueQuickBatch(s,batch)),flush:()=>e.flush()});await Promise.all([b.capture('milk',1,id()),b.capture('milk',1,id())]);assert.equal(writes,0);assert.equal((await store.read(uid)).outbox.length,2);online=true;await e.flush();assert.equal((await store.read(uid)).outbox[0].status,'pending');await e.flush();assert.equal(remote.products[0].stockMicros,3e6);assert.equal(remote.operations.length,2);assert.equal(writes,3);assert.equal((await store.read(uid)).outbox.filter(i=>i.status==='ack').length,2);}finally{await e.close();}
});
test('7.1 : erreur d’écriture bloquante conserve la chaîne et interdit le dépassement',async()=>{
 const store=memoryStore();await store.mutate(uid,()=>initial());let writes=0;const e=familyEngine({uid,store,online:()=>true,transport:{member:async()=>{},watch:()=>()=>{},write:async()=>{writes++;throw {code:'invalid-argument'};}}});try{await e.start();const s=add(add(initial(),1),1);await e.submit([]);await e.mutate(()=>s);await e.flush();assert.equal(writes,1);assert.deepEqual(e.state.outbox.map(i=>i.status),['invalid','pending']);assert.equal(quickView(e.state,'milk').blocked,'invalid');assert.equal(e.state.cache.products[0].stockMicros,1e6);}finally{await e.close();}
});
test('7.1 : retours FR/DE pour attente, confirmation, zéro, erreurs et revue',()=>{
 const s=add(initial(),1);assert.match(quickFeedback(quickView(s,'milk'),'fr'),/En attente.*2 L.*confirmé.*1 L/);assert.match(quickFeedback(quickView(s,'milk'),'de'),/Ausstehend.*2 L.*Bestätigter.*1 L/);assert.match(quickWords.fr.zero,/zéro/);assert.match(quickWords.de.zero,/null/);assert.match(quickWords.fr.error,/page ouverte/);assert.match(quickWords.de.error,/offen lassen/);s.outbox[0].status='conflict';assert.match(quickFeedback(quickView(s,'milk'),'fr'),/conservés/);assert.match(quickFeedback(quickView(s,'milk'),'de'),/erhalten/);s.outbox[0].status='invalid';assert.match(quickFeedback(quickView(s,'milk'),'fr'),/refusée/);assert.match(quickFeedback(quickView(s,'milk'),'de'),/abgelehnt/);
});

test('7.1 : deux onglets sur la même révision gardent leurs deux gestes pour revue',()=>{
 const left=quickIntent(initial(),'milk',1,id()),right=quickIntent(initial(),'milk',1,id()),state=enqueueQuick(enqueueQuick(initial(),left),right);assert.equal(state.outbox.length,2);assert.equal(quickView(state,'milk').blocked,'context-changed');assert.equal(quickView(state,'milk').count,2);
});
test('7.1 : limite supérieure après conflit : abandon possible, aucune quantité hors contrat',()=>{
 const s=add(initial(),1);s.outbox[0].status='conflict';const p={...s.cache.products[0],revision:2,stockMicros:1e12},plan=quickReviewPlan(s,'milk',p,[],id());assert.equal(plan.blocked,'quantity-range');assert.throws(()=>applyQuickReview(s,plan));assert.equal(applyQuickReview(s,plan,true).cache.products[0].stockMicros,1e12);
});

test('7.1 : plafond historique de 5000 entrées conservé, refus clair et aucune purge',async()=>{
 let s=initial();const c=quickIntent(s,'milk',1,id()).command;s.outbox=Array.from({length:5000},(_,n)=>({command:{...c,operationId:'historical-operation-'+n},status:'ack'}));validateState(s);const before=structuredClone(s.outbox),b=quickBuffer({getState:()=>s,persist:async batch=>{s=enqueueQuickBatch(s,batch)},flush:()=>{}});await assert.rejects(b.capture('milk',1,id()),/backup-limit/);assert.deepEqual(s.outbox,before);assert.equal(b.volatile.length,1);const v=quickView(s,'milk',b.volatile);assert.equal(v.storageReason,'backup-limit');assert.match(quickFeedback(v,'fr'),/File locale pleine/);assert.match(quickFeedback(v,'de'),/Warteschlange voll/);
});
