import {query,where,orderBy,limit,startAfter,documentId} from 'firebase/firestore';
import {scopedFirestore} from '../../security/src/scoped-firestore.mjs';
import {familyWriterCore} from '../../security/src/family-writer-core.mjs';
import {digest} from '../../security/src/contracts.mjs';
import {TargetPolicyError} from '../preprod/target.js';
import {boundedHistory} from './pagination.js';
import {validUid} from './state.js';
import {activeDevice} from './membership.js';
export function jsonData(x){if(x==null)return x;if(x.toDate)return x.toDate().toISOString();if(Array.isArray(x))return x.map(jsonData);if(typeof x==='object')return Object.fromEntries(Object.entries(x).map(([k,v])=>[k,jsonData(v)]));return x;}
export function transportCore(db,uid,policy){
 const {check,doc,collection,getDocFromServer,getDocsFromServer,onSnapshot,network}=scopedFirestore(db,policy);
 if(!validUid(uid))throw Error('invalid-uid');const writer=familyWriterCore(db,uid,policy),stops=new Set();
 const watch=(ref,callback,error)=>{const stop=onSnapshot(ref,{includeMetadataChanges:true},callback,error);stops.add(stop);return()=>{stops.delete(stop);stop();};};
 const member=async()=>{check();const m=(await getDocFromServer(doc(db,'members',uid))).data();if(!activeDevice(m,uid))throw Object.assign(Error(m?.status==='revoked'?'revoked':'waiting'),{code:m?.status==='revoked'?'permission-denied':'device-pending'});};
 return {member,
 watch:(kind,fn,error)=>watch(kind==='member'?doc(db,'members',uid):collection(db,kind==='groups'?'shoppingLines':'products'),snapshot=>{
  if(snapshot.metadata.hasPendingWrites)return;
  if(kind==='member'){if(snapshot.data()?.status!=='active')error({code:snapshot.data()?.status==='revoked'?'permission-denied':'device-pending'});else fn(null,{fromCache:snapshot.metadata.fromCache});}
  else fn(snapshot.docs.map(d=>jsonData(d.data())),{fromCache:snapshot.metadata.fromCache,changes:snapshot.docChanges().length});
 },error),
 write:async command=>{check();try{return await writer(command);}catch(e){check();if(e.code==='permission-denied'){try{await member();}catch(next){if(next instanceof TargetPolicyError)throw next;throw e;}throw Object.assign(Error('write-rejected'),{code:'invalid-argument'});}throw e;}},
 commandHash:c=>digest({...c,eventVersion:2}),
 receipt:async id=>{const r=await getDocFromServer(doc(db,'operations',id));return r.exists()?jsonData(r.data()):null;},
 product:async id=>{const r=await getDocFromServer(doc(db,'products',id));return r.exists()?jsonData(r.data()):null;},
 history:async id=>(await getDocsFromServer(query(collection(db,'operations'),where('targetId','==',id),orderBy('createdAt','desc'),limit(20)))).docs.map(d=>jsonData(d.data())),
 historyAll:(id,cap=200)=>boundedHistory(async(cursor,size)=>{
  check();const args=[where('targetId','==',id),orderBy('createdAt','desc'),orderBy(documentId(),'desc')];if(cursor)args.push(startAfter(cursor.time,cursor.id));const snap=await getDocsFromServer(query(collection(db,'operations'),...args,limit(size))),last=snap.docs.at(-1);return {events:snap.docs.map(d=>jsonData(d.data())),cursor:last?{time:last.data().createdAt,id:last.id}:null};
 },cap),
 observeMembership:(fn,error)=>watch(doc(db,'members',uid),snapshot=>{if(!snapshot.metadata.fromCache)fn(snapshot.data());},error),
 network,close:async()=>{for(const stop of stops)stop();stops.clear();}};
}
