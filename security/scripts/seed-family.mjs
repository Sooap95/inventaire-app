// Amorçage administratif FICTIF, uniquement pour la recette locale.
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDocs,collection,writeBatch,Timestamp,getDoc,runTransaction} from 'firebase/firestore';
import {readFileSync,writeFileSync} from 'node:fs';
import {PROJECT,EMULATOR,assertEmulator} from '../src/contracts.mjs';
if(process.env.FIRESTORE_EMULATOR_HOST!==EMULATOR)throw Error('Emulator endpoint required');
if(process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_TOKEN)throw Error('Credentials forbidden');
const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{host:'127.0.0.1',port:8180,rules:readFileSync(new URL('../firestore.rules',import.meta.url),'utf8')}});
const action=process.argv[2]||'seed';
try{
 if(action==='seed')await env.clearFirestore();
 if(action==='clear-for-restore'){const backup=JSON.parse(readFileSync(new URL('../.cache/family-admin-backup.json',import.meta.url)));if(backup.project!==PROJECT||backup.format!=='inventaire-emulator-admin')throw Error('Fictional backup required');await env.clearFirestore();}
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();assertEmulator(db);
  if(action==='seed'){
   // Aucune préautorisation : chaque UID doit suivre la procédure administrative.
   const fixtures=[['milk','Lait','L',1,1,3],['butter','Beurre','article',0,1,2],['aptamil','Aptamil','boîte',0,1,2],['eggs','œufs','boîte',0,1,1]];
   for(const [id,name,unit,stock,threshold,target] of fixtures)await setDoc(doc(db,'products',id),{schemaVersion:2,id,revision:1,name,unit,stockMicros:stock*1e6,thresholdMicros:threshold*1e6,targetMicros:target*1e6,frequency:'',lastRestocked:null,deleted:false,legacy:{fixture:true,category:'Alimentation'},createdBy:'family-alice',authorUid:'family-alice',updatedAt:Timestamp.fromMillis(1),lastOperationId:'bootstrap-'+id});
  }  else if(action==='backup'){
   const data={format:'inventaire-emulator-admin',version:1,project:PROJECT,collections:{}};for(const col of ['products','shoppingLines','operations','members'])data.collections[col]=(await getDocs(collection(db,col))).docs.map(d=>({id:d.id,data:encode(d.data())}));writeFileSync(new URL('../.cache/family-admin-backup.json',import.meta.url),JSON.stringify(data));
  }else if(action==='clear-for-restore'){return;}else if(action==='check-restore'){
   const backup=JSON.parse(readFileSync(new URL('../.cache/family-admin-backup.json',import.meta.url)));for(const col of ['products','shoppingLines','operations','members']){const docs=(await getDocs(collection(db,col))).docs.map(d=>({id:d.id,data:encode(d.data())})).sort((a,b)=>a.id.localeCompare(b.id));const saved=backup.collections[col].sort((a,b)=>a.id.localeCompare(b.id));if(stable(docs)!==stable(saved))throw Error('Restore mismatch');}
  }else if(action==='restore'){
   const data=JSON.parse(readFileSync(new URL('../.cache/family-admin-backup.json',import.meta.url)));if(data.format!=='inventaire-emulator-admin'||data.version!==1||data.project!==PROJECT)throw Error('Backup format');
   const entries=Object.entries(data.collections).flatMap(([col,docs])=>{if(!['products','shoppingLines','operations','members'].includes(col)||!Array.isArray(docs))throw Error('Backup collection');return docs.map(d=>({col,...d}));});if(entries.length>400)throw Error('Fictional backup limit');
   // Aucun écrasement existant : restauration identique = no-op ; conflit = refus entier.
   await runTransaction(db,async tx=>{const missing=[];for(const e of entries){const current=await tx.get(doc(db,e.col,e.id));if(current.exists()){if(stable(encode(current.data()))!==stable(e.data))throw Error('Backup conflict');}else missing.push(e);}
    for(const e of missing)tx.set(doc(db,e.col,e.id),decode(e.data));});
  }else throw Error('Unknown local action');
 });
}finally{await env.cleanup();}
function encode(x){if(x?.toDate)return {__timestamp:[x.seconds,x.nanoseconds]};if(Array.isArray(x))return x.map(encode);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,encode(v)]));return x;}
function decode(x){if(x&&Object.keys(x).length===1&&Array.isArray(x.__timestamp))return new Timestamp(...x.__timestamp);if(Array.isArray(x))return x.map(decode);if(x&&typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,decode(v)]));return x;}

function stable(x){if(Array.isArray(x))return JSON.stringify(x.map(v=>JSON.parse(stable(v))));if(x&&typeof x==='object')return JSON.stringify(Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(stable(x[k]))])));return JSON.stringify(x);}
