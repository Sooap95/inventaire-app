// Toutes les entrées RPC, callbacks de retry et lectures de reprise passent la garde.
import * as sdk from 'firebase/firestore';
import {checkTarget} from './target-policy.mjs';
import {TargetPolicyError} from '../../src/preprod/target.js';
export function scopedFirestore(db,policy){
 const check=()=>checkTarget(policy,db),unpack=x=>x?._delegate||x;
 check();
 const reference=ref=>{check();if(unpack(ref?.firestore)!==unpack(db))throw new TargetPolicyError('TARGET_REFERENCE_MISMATCH');};
 const read=method=>async ref=>{reference(ref);const value=await sdk[method](ref);check();return value;};
 return {check,
  doc:(database,...args)=>{check();if(unpack(database)!==unpack(db))throw new TargetPolicyError('TARGET_REFERENCE_MISMATCH');return sdk.doc(database,...args);},
  collection:(database,...args)=>{check();if(unpack(database)!==unpack(db))throw new TargetPolicyError('TARGET_REFERENCE_MISMATCH');return sdk.collection(database,...args);},
  getDocFromServer:read('getDocFromServer'),getDocsFromServer:read('getDocsFromServer'),
  runTransaction:(database,fn,options)=>{check();if(unpack(database)!==unpack(db))throw new TargetPolicyError('TARGET_REFERENCE_MISMATCH');return sdk.runTransaction(database,async tx=>{
   check();const guarded={get:async ref=>{reference(ref);const result=await tx.get(ref);check();return result;},set:(ref,...args)=>{reference(ref);tx.set(ref,...args);return guarded;}};
   const result=await fn(guarded);check();return result;
  },options);},
  onSnapshot:(ref,options,fn,error)=>{reference(ref);let stop,failed=false;const fail=e=>{if(failed)return;failed=true;stop?.();error(e);};stop=sdk.onSnapshot(ref,options,value=>{try{check();}catch(e){fail(e);return;}if(!failed)fn(value);},e=>{try{check();}catch(next){fail(next);return;}fail(e);});return()=>stop();},
  network:async on=>{check();await (on?sdk.enableNetwork(db):sdk.disableNetwork(db));check();}
 };
}
