import test from 'node:test';import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {initializeAuth,inMemoryPersistence,connectAuthEmulator,signInAnonymously,getIdTokenResult} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDocFromServer,getDocs,collection,setDoc,deleteDoc,Timestamp,setLogLevel} from 'firebase/firestore';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {readFileSync} from 'node:fs';
import {PROJECT,EMULATOR} from '../src/contracts.mjs';
import {prepareDeviceAuthorization,applyDeviceAuthorization} from '../src/device-admin.mjs';
setLogLevel('silent');let env,apps=[];
async function device(){const app=initializeApp({projectId:PROJECT,apiKey:'fictional-emulator-key',appId:'fictional-device'},crypto.randomUUID());apps.push(app);const auth=initializeAuth(app,{persistence:inMemoryPersistence});connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});const user=(await signInAnonymously(auth)).user;const db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8180);return {uid:user.uid,db,user};}
const admin=fn=>env.withSecurityRulesDisabled(c=>fn(c.firestore()));
const allow=d=>admin(async s=>{const p=await prepareDeviceAuthorization(s,{uid:d.uid,action:'allow',label:'Test fictif'});return applyDeviceAuthorization(s,p,p.checksum);});
test.before(async()=>{assert.equal(process.env.FIRESTORE_EMULATOR_HOST,EMULATOR);assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9099');env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});});
test.beforeEach(async()=>{await env.clearFirestore();await admin(s=>setDoc(doc(s,'products','fixture'),{id:'fixture',stockMicros:1000000,unit:'L',schemaVersion:2}));});
test.afterEach(async()=>{await Promise.all(apps.splice(0).map(deleteApp));});test.after(async()=>env?.cleanup());
test('Auth Emulator réel : identité anonyme inconnue, statut propre lisible et inventaire refusé',async()=>{
 const d=await device(),token=await getIdTokenResult(d.user);assert.equal(token.signInProvider,'anonymous');assert.equal((await getDocFromServer(doc(d.db,'members',d.uid))).exists(),false);await assertFails(getDocFromServer(doc(d.db,'products','fixture')));await assertFails(getDocs(collection(d.db,'members')));await assertFails(getDocFromServer(doc(d.db,'members','another-device')));
});
test('autorisation administrative fictive ouvre l’accès sans changer l’UID',async()=>{
 const d=await device();await allow(d);await assertSucceeds(getDocFromServer(doc(d.db,'products','fixture')));assert.equal(d.user.uid,d.uid);
});
test('auto-autorisation et modification/suppression des autorisations refusées même après autorisation',async()=>{
 const d=await device(),m={schemaVersion:2,uid:d.uid,role:'device',authType:'anonymous',status:'active'};await assertFails(setDoc(doc(d.db,'members',d.uid),m));await allow(d);await assertFails(setDoc(doc(d.db,'members',d.uid),{...m,label:'hijack'}));await assertFails(deleteDoc(doc(d.db,'members',d.uid)));
});
test('révocation effective avec le même ancien jeton et statut propre encore lisible',async()=>{
 const d=await device();await allow(d);await admin(async s=>{const p=await prepareDeviceAuthorization(s,{uid:d.uid,action:'revoke'});await applyDeviceAuthorization(s,p,p.checksum);});await assertFails(getDocFromServer(doc(d.db,'products','fixture')));assert.equal((await getDocFromServer(doc(d.db,'members',d.uid))).data().status,'revoked');
});
test('nouvelle identité : aucune adoption de l’ancienne autorisation ni perte de données familiales',async()=>{
 const old=await device();await allow(old);const fresh=await device();assert.notEqual(fresh.uid,old.uid);await assertFails(getDocFromServer(doc(fresh.db,'products','fixture')));await allow(fresh);assert.equal((await getDocFromServer(doc(fresh.db,'products','fixture'))).data().stockMicros,1000000);
});
test('plan administratif contrôlé : checksum, rejeu, conflit de deux décisions et UID inconnu',async()=>{
 const d=await device();await admin(async s=>{const a=await prepareDeviceAuthorization(s,{uid:d.uid,action:'allow'}),b=await prepareDeviceAuthorization(s,{uid:d.uid,action:'allow',label:'Concurrent'});await assert.rejects(applyDeviceAuthorization(s,a,'bad-checksum'));await applyDeviceAuthorization(s,a,a.checksum);assert.equal((await applyDeviceAuthorization(s,a,a.checksum)).replayed,true);await assert.rejects(applyDeviceAuthorization(s,b,b.checksum),/plan-conflict/);await assert.rejects(prepareDeviceAuthorization(s,{uid:'unknown-fictitious-uid',action:'allow'}),/anonymous-account-required/);});
});
test('même UID sous fournisseur non anonyme ou ancien membre v1 : refus par défaut',async()=>{
 const d=await device();await allow(d);const other=env.authenticatedContext(d.uid,{firebase:{sign_in_provider:'password'}}).firestore();await assertFails(getDocFromServer(doc(other,'products','fixture')));await admin(s=>setDoc(doc(s,'members',d.uid),{schemaVersion:1,uid:d.uid,role:'family',status:'active',recoverable:true}));await assertFails(getDocFromServer(doc(d.db,'products','fixture')));
});
test('rejouer une ancienne autorisation après révocation ne réactive jamais l’appareil',async()=>{
 const d=await device();await admin(async s=>{const allowPlan=await prepareDeviceAuthorization(s,{uid:d.uid,action:'allow'});await applyDeviceAuthorization(s,allowPlan,allowPlan.checksum);const revokePlan=await prepareDeviceAuthorization(s,{uid:d.uid,action:'revoke'});await applyDeviceAuthorization(s,revokePlan,revokePlan.checksum);await assert.rejects(applyDeviceAuthorization(s,allowPlan,allowPlan.checksum),/device-plan-conflict/);});await assertFails(getDocFromServer(doc(d.db,'products','fixture')));
});
test('perte d’identité : CLI audit d’un acquittement perdu, aucun transfert ni double écriture',async()=>{
 const {familyWriter}=await import('../src/family-writer.mjs'),{fresh,enqueue,exportBackup}=await import('../../src/family/state.js');const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),path=await import('node:path'),{execFile}=await import('node:child_process'),{promisify}=await import('node:util');
 const old=await device(),next=await device();await allow(old);await allow(next);await admin(s=>setDoc(doc(s,'products','fixture'),{schemaVersion:2,id:'fixture',revision:1,name:'Lait',unit:'L',stockMicros:1000000,thresholdMicros:1000000,targetMicros:3000000,frequency:'',lastRestocked:null,deleted:false,legacy:{},createdBy:old.uid,authorUid:old.uid,updatedAt:Timestamp.fromMillis(1),lastOperationId:'fixture-bootstrap'}));
 const command={actorUid:old.uid,operationId:crypto.randomUUID(),confirmed:true,targetCollection:'products',targetId:'fixture',expectedRevision:1,action:'product.write',data:{stockMicros:0}},missing={...command,operationId:crypto.randomUUID(),expectedRevision:2,data:{stockMicros:2000000}};
 await familyWriter(old.db,old.uid)(command);const file=exportBackup(enqueue(fresh(old.uid),[command,missing])),dir=mkdtempSync(path.join(tmpdir(),'inventaire-identity-audit-'));
 try{const input=path.join(dir,'old.json'),output=path.join(dir,'audit.json');writeFileSync(input,JSON.stringify(file));await promisify(execFile)(process.execPath,['--require',new URL('../scripts/loopback-only.cjs',import.meta.url).pathname,new URL('../scripts/recovery.mjs',import.meta.url).pathname,'identity-audit',input,next.uid,output],{env:process.env});const report=JSON.parse(readFileSync(output));assert.deepEqual(report.outcomes.map(x=>x.status),['server-received','manual-review-required']);assert.deepEqual(report.changes,[]);assert.equal((await getDocFromServer(doc(next.db,'products','fixture'))).data().stockMicros,0);assert.equal((await getDocs(collection(next.db,'operations'))).size,1);}finally{rmSync(dir,{recursive:true,force:true});}
});
