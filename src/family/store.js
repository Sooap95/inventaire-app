import {fresh,copy,validateState} from './state.js';
export class LocalConflict extends Error{constructor(){super('local-revision-conflict');this.code='sync-conflict';}}
export async function indexedStore(databaseName='inventaire-family-emulator-v1'){
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(databaseName,1);r.onupgradeneeded=()=>r.result.createObjectStore('accounts',{keyPath:'uid'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(Error('storage-unavailable'));r.onblocked=()=>reject(Error('storage-blocked'));});
 db.onversionchange=()=>db.close();
 return {read:uid=>new Promise((resolve,reject)=>{const tx=db.transaction('accounts'),r=tx.objectStore('accounts').get(uid);r.onsuccess=()=>resolve(validateState(r.result||fresh(uid)));r.onerror=()=>reject(Error('storage-read'));}),
 mutate:(uid,fn,revision=null)=>new Promise((resolve,reject)=>{const tx=db.transaction('accounts','readwrite'),s=tx.objectStore('accounts'),r=s.get(uid);let result,error;
  r.onsuccess=()=>{try{const before=r.result||fresh(uid);if(revision!==null&&before.revision!==revision)throw new LocalConflict();result=fn(copy(before));if(result?.then)throw Error('async-local-transaction-forbidden');result.revision=before.revision+1;validateState(result);s.put(result);}catch(e){error=e;tx.abort();}};
  tx.oncomplete=()=>resolve(copy(result));tx.onabort=()=>reject(error||Error('storage-write'));tx.onerror=()=>{};
 }),close:()=>db.close()};
}
export function memoryStore(){const data=new Map();return {read:async uid=>copy(data.get(uid)||fresh(uid)),mutate:async(uid,fn,revision=null)=>{const before=data.get(uid)||fresh(uid);if(revision!==null&&before.revision!==revision)throw new LocalConflict();const next=fn(copy(before));next.revision=before.revision+1;validateState(next);data.set(uid,copy(next));return copy(next);},close:()=>{}};}
