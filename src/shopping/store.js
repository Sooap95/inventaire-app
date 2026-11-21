import {emptyState,fail} from './domain.js';
export function finalize(current,expectedRevision,operationId,signature,next){
  const previous=current.operations.find(op=>op.id===operationId);
  if(previous){if(previous.signature!==signature)fail('operation');return {state:structuredClone(current),replayed:true};}
  if(current.revision!==expectedRevision)fail('conflict');
  if(next.formatVersion!==1||next.revision!==expectedRevision)fail('format');
  const state=structuredClone(next);state.revision=current.revision+1;
  // Une restauration conserve le journal importé ; aucune ancienne opération
  // locale n'est supprimée et un ID au contenu différent bloque la transaction.
  const operations=structuredClone(current.operations);
  for(const op of next.operations){
    const old=operations.find(x=>x.id===op.id);
    if(old&&old.signature!==op.signature)fail('operation');
    if(!old)operations.push(structuredClone(op));
  }
  const imported=operations.find(op=>op.id===operationId);
  if(imported&&imported.signature!==signature)fail('operation');
  state.operations=imported?operations:[...operations,{id:operationId,signature}];return {state,replayed:false};
}
export function memoryStore(seed=emptyState()){
  let state=structuredClone(seed);
  return {read:async()=>structuredClone(state),commit:async(revision,id,signature,next)=>{
    const result=finalize(state,revision,id,signature,next);state=result.state;return structuredClone(result);
  }};
}
export async function indexedStore(){
  const db=await new Promise((resolve,reject)=>{
    const request=indexedDB.open('inventaire-shopping-local-v1',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('shoppingLines');
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  db.onversionchange=()=>db.close();
  const read=()=>new Promise((resolve,reject)=>{
    const request=db.transaction('shoppingLines').objectStore('shoppingLines').get('state');
    request.onsuccess=()=>{const state=request.result||emptyState();if(state.formatVersion!==1||!Array.isArray(state.lines)||!Array.isArray(state.operations)||!Array.isArray(state.aliases)||!Number.isInteger(state.revision)){reject(new Error('format'));return;}resolve(state);};request.onerror=()=>reject(request.error);
  });
  const commit=(revision,id,signature,next)=>new Promise((resolve,reject)=>{
    const transaction=db.transaction('shoppingLines','readwrite'),object=transaction.objectStore('shoppingLines');let result,error;
    const request=object.get('state');
    request.onsuccess=()=>{try{result=finalize(request.result||emptyState(),revision,id,signature,next);if(!result.replayed)object.put(result.state,'state');}catch(e){error=e;transaction.abort();}};
    transaction.oncomplete=()=>resolve(result);transaction.onabort=()=>reject(error||transaction.error||new Error('storage'));transaction.onerror=()=>{};
  });
  return {read,commit,close:()=>db.close()};
}
