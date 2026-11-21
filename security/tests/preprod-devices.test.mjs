import test from 'node:test';import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {initializeAuth,inMemoryPersistence,connectAuthEmulator,signInAnonymously} from 'firebase/auth';
import {getFirestore,connectFirestoreEmulator,doc,getDocFromServer,setDoc,setLogLevel} from 'firebase/firestore';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {readFileSync} from 'node:fs';
setLogLevel('silent');const project='demo-inventaire-v02',base=`http://127.0.0.1:8180/v1/projects/${project}/databases/(default)/documents`;
const request=async(path,body)=>{const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200);return r.json();};
let env,app,uid,db;
test.before(async()=>{env=await initializeTestEnvironment({projectId:project,firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});await env.clearFirestore();app=initializeApp({projectId:project,apiKey:'fictional-a3-key',appId:'fictional-a3-app'},'a3-rest-test');const auth=initializeAuth(app,{persistence:inMemoryPersistence});connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});uid=(await signInAnonymously(auth)).user.uid;db=getFirestore(app);connectFirestoreEmulator(db,'127.0.0.1',8180);await env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),'products','milk'),{stockMicros:1000000}));});
test.after(async()=>{await deleteApp(app);await env.cleanup();});
async function transition(status,revision){
 const tx=(await request(':beginTransaction',{options:{readWrite:{}}})).transaction;
 const query=await request(':runQuery',{structuredQuery:{from:[{collectionId:'members'}],limit:3},transaction:tx});
 const previous=query.find(row=>row.document)?.document;
 const values={schemaVersion:2,uid,role:'device',authType:'anonymous',status,label:'Profil A',revision,lastAdminOperationId:'a3-rest-'+revision};
 const fields=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,typeof v==='number'?{integerValue:String(v)}:{stringValue:v}]));
 await request(':commit',{transaction:tx,writes:[{update:{name:`projects/${project}/databases/(default)/documents/members/${uid}`,fields},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:previous?{updateTime:previous.updateTime}:{exists:false}}]});
}
test('A3 REST émulateur : transaction administrative ouvre uniquement le profil choisi',async()=>{await assertFails(getDocFromServer(doc(db,'products','milk')));await transition('active',1);await assertSucceeds(getDocFromServer(doc(db,'products','milk')));const member=(await getDocFromServer(doc(db,'members',uid))).data();assert.equal(member.status,'active');assert.equal(member.revision,1);assert.equal(Object.keys(member).length,9);assert.ok(member.updatedAt.toDate());});
test('A3 REST émulateur : révocation avec précondition, produit intact et ancien jeton refusé',async()=>{await transition('revoked',2);await assertFails(getDocFromServer(doc(db,'products','milk')));assert.equal((await getDocFromServer(doc(db,'members',uid))).data().status,'revoked');assert.equal((await request('/products/milk')).fields.stockMicros.integerValue,'1000000');});
