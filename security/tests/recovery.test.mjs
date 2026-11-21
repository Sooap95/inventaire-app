import test from 'node:test';import assert from 'node:assert/strict';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDocFromServer,getDocs,collection,Timestamp,Bytes,GeoPoint,vector,setLogLevel} from 'firebase/firestore';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {createHash} from 'node:crypto';
import {completeBackup,verifyBackup,packBackup,restorePlan,applyDataPlan,rollbackPlan,encode,decode,snapshot} from '../src/backup.mjs';
import {historicalMigration} from '../src/historical-migration.mjs';
import {PROJECT,EMULATOR,canonical,digest} from '../src/contracts.mjs';
import {emptyState,parseList,planBatch} from '../../src/shopping/domain.js';
setLogLevel('silent');let env;
const admin=async fn=>{let result;await env.withSecurityRulesDisabled(async c=>{result=await fn(c.firestore());});return result;};
const legacy={id:'old-id',name:'Lait',unit:'L',stock:1,threshold:1,target:3,frequency:'',customField:{kept:true},restockHistory:[{qty:2,date:'2020-01-01',by:'Auteur historique fictif'}]};
const rawManual=()=>{const lines=parseList('lait x3',[legacy]);return JSON.stringify({format:'inventaire-shopping-local',version:1,state:planBatch(emptyState(),[legacy],lines,{[lines[0].id]:'set_total'}).next});};
test.before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,EMULATOR);env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});});
test.beforeEach(async()=>{await env.clearFirestore();await admin(s=>setDoc(doc(s,'products',legacy.id),legacy));});test.after(async()=>env?.cleanup());
test('sauvegarde complète : manifestes des quatre collections, types Firestore et données arbitraires préservés',async()=>admin(async s=>{
 const original={stamp:new Timestamp(42,123456789),bytes:Bytes.fromUint8Array(new Uint8Array([0,255,42])),point:new GeoPoint(46.5,7.2),reference:doc(s,'products',legacy.id),special:[NaN,Infinity,-Infinity],vector:vector([.1,.2]),nested:{__timestamp:'field preserved'}};
 await setDoc(doc(s,'operations','typed-fixture'),original);const file=await completeBackup(s);assert.equal((await verifyBackup(file,s)).count,2);assert.equal(Object.keys(file.manifest).length,4);const encoded=file.data.operations[0].data;assert.deepEqual(encode(decode(encoded,s)),encoded);assert.equal(decode(encode(original),s).stamp.nanoseconds,123456789);assert.equal(decode(encoded,s).stamp.nanoseconds,(await getDocFromServer(doc(s,'operations','typed-fixture'))).data().stamp.nanoseconds);
}));
test('restauration réelle : base fictive vidée, égalité intégrale, rejeu sans écritures',async()=>{
 const backup=await admin(s=>completeBackup(s));await env.clearFirestore();await admin(async s=>{const plan=await restorePlan(s,backup);assert.equal((await applyDataPlan(s,plan,plan.checksum)).writes,1);assert.equal((await applyDataPlan(s,plan,plan.checksum)).writes,0);assert.equal(canonical(await snapshot(s)),canonical(backup.data));});
});
test('restauration : conflit existant et données supplémentaires conservés sans écrasement',async()=>admin(async s=>{
 const backup=await completeBackup(s);await setDoc(doc(s,'products',legacy.id),{...legacy,stock:9});await setDoc(doc(s,'products','unrelated'),{id:'unrelated',value:42});const before=await snapshot(s),plan=await restorePlan(s,backup);assert.equal(plan.conflicts.length,1);assert.equal(plan.preserved.length,1);await assert.rejects(applyDataPlan(s,plan,plan.checksum),/plan-blocked/);assert.equal(canonical(await snapshot(s)),canonical(before));
}));
test('restauration : checksum, version, typage, doublons et fichier altéré refusés',async()=>admin(async s=>{
 const file=await completeBackup(s);const changed=structuredClone(file);changed.data.products[0].id='tampered';await assert.rejects(verifyBackup(changed,s),/checksum/);await assert.rejects(verifyBackup({...file,version:99},s),/format/);
 const noncanonical=structuredClone(file.data);noncanonical.products[0].data[1].find(x=>x[0]==='stock')[1][1]='01';await assert.rejects(verifyBackup(await packBackup(noncanonical),s),/noncanonical/);
 const duplicate=await packBackup({...file.data,products:[file.data.products[0],file.data.products[0]]});await assert.rejects(verifyBackup(duplicate,s),/document/);assert.throws(()=>decode(['map',[['same',['null']],['same',['null']]]],s),/invalid-map/);
}));
test('restauration : écriture concurrente entre aperçu et validation bloque toute la transaction',async()=>{
 const backup=await admin(s=>completeBackup(s));await env.clearFirestore();await admin(async s=>{const plan=await restorePlan(s,backup);await setDoc(doc(s,'products',legacy.id),{stock:99});await assert.rejects(applyDataPlan(s,plan,plan.checksum),/data-plan-conflict/);assert.equal((await getDocFromServer(doc(s,'products',legacy.id))).data().stock,99);});
});
test('migration : total explicite obligatoire, source archivée exactement et identifiants inchangés',async()=>admin(async s=>{
 const backup=await completeBackup(s),raw=rawManual(),preview=await historicalMigration(backup,{manualExports:[raw]},s);assert.equal(preview.conflicts[0].code,'explicit-final-total-required');await assert.rejects(applyDataPlan(s,preview,preview.checksum),/plan-blocked/);
 const g=preview.groupsToReview[0],plan=await historicalMigration(backup,{manualExports:[raw],totals:{[g.id]:{sourceHash:g.sourceHash,choice:'set_total',totalMicros:3000000}}},s);assert.equal(plan.conflicts.length,0);await applyDataPlan(s,plan,plan.checksum);const p=(await getDocFromServer(doc(s,'products',legacy.id))).data();assert.equal(p.id,legacy.id);assert.deepEqual(p.legacy,legacy);assert.equal(p.stockMicros,1000000);const group=(await getDocFromServer(doc(s,'shoppingLines',g.id))).data();assert.equal(group.totalMicros,3000000);
 const archives=(await getDocs(collection(s,'operations'))).docs.map(d=>d.data()).filter(d=>d.kind==='migration.archive').sort((a,b)=>a.partIndex-b.partIndex);const restored=Buffer.concat(archives.map(d=>Buffer.from(d.payload,'base64'))).toString();assert.equal(restored,raw);assert.equal(createHash('sha256').update(restored).digest('hex'),g.sourceHash);
 const rollback=await rollbackPlan(s,plan);await applyDataPlan(s,rollback,rollback.checksum);assert.equal(canonical(await snapshot(s)),canonical(backup.data));assert.equal((await applyDataPlan(s,rollback,rollback.checksum)).replayed,true);
}));
test('migration : plusieurs sources du même groupe ne s’additionnent jamais automatiquement',async()=>admin(async s=>{
 const backup=await completeBackup(s),raw=rawManual(),plan=await historicalMigration(backup,{manualExports:[raw,raw]},s);assert.ok(plan.conflicts.some(i=>['multiple-sources-explicit-reconciliation-required','duplicate-source-backup'].includes(i.code)));await assert.rejects(applyDataPlan(s,plan,plan.checksum));assert.equal((await getDocFromServer(doc(s,'products',legacy.id))).data().stock,1);
}));
test('rollback : achat/correction après migration bloque le retour aveugle et préserve les nouvelles données',async()=>admin(async s=>{
 const backup=await completeBackup(s),plan=await historicalMigration(backup,{},s);await applyDataPlan(s,plan,plan.checksum);const p=(await getDocFromServer(doc(s,'products',legacy.id))).data();await setDoc(doc(s,'products',legacy.id),{...p,revision:2,stockMicros:2500000,lastOperationId:'fictional-new-purchase'});const rollback=await rollbackPlan(s,plan);await assert.rejects(applyDataPlan(s,rollback,rollback.checksum),/data-plan-conflict/);assert.equal((await getDocFromServer(doc(s,'products',legacy.id))).data().stockMicros,2500000);
}));
test('migration : précision/unité/identifiant ambigus et base déjà canonique bloqués',async()=>admin(async s=>{
 for(const invalid of [{stock:.1234567},{unit:''},{id:'different-id'},{schemaVersion:2,stockMicros:1e6}]){await setDoc(doc(s,'products',legacy.id),{...legacy,...invalid});const b=await completeBackup(s),plan=await historicalMigration(b,{},s);assert.ok(plan.conflicts.length);await assert.rejects(applyDataPlan(s,plan,plan.checksum),/plan-blocked/);}
}));
test('procédure CLI complète : export/verify, plan de migration, application et retour arrière vérifié',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'inventaire-recovery-fixture-')),exec=promisify(execFile);const cli=new URL('../scripts/recovery.mjs',import.meta.url).pathname,guard=new URL('../scripts/loopback-only.cjs',import.meta.url).pathname;
 const run=async(...args)=>JSON.parse((await exec(process.execPath,['--require',guard,cli,...args],{env:process.env})).stdout);
 try{
  const file=path.join(dir,'complete.json'),input=path.join(dir,'inputs.json'),migration=path.join(dir,'migration.json'),rollback=path.join(dir,'rollback.json');
  const info=await run('backup',file);assert.equal(info.counts.products,1);assert.equal((await run('verify',file)).count,1);writeFileSync(input,JSON.stringify({manualFiles:[],totals:{}}));
  const preview=await run('migration-plan',file,input,migration);assert.equal(preview.conflicts,0);assert.equal((await run('apply',migration,preview.checksum)).writes,2);
  const reverse=await run('rollback-plan',migration,rollback);await run('apply',rollback,reverse.checksum);const backup=JSON.parse(readFileSync(file));await admin(async s=>assert.equal(canonical(await snapshot(s)),canonical(backup.data)));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
