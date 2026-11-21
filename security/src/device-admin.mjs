import {doc,getDocFromServer,runTransaction,serverTimestamp} from 'firebase/firestore';
import {PROJECT,digest,assertEmulator} from './contracts.mjs';
import {validUid} from '../../src/family/state.js';
import {fictionalAnonymousAccount,assertAdminLab} from './emulator-admin.mjs';
const marker='inventaire-device-authorization-plan';
export async function prepareDeviceAuthorization(db,{uid,action,label=''}){
 assertAdminLab();assertEmulator(db);if(!validUid(uid)||!['allow','revoke'].includes(action)||typeof label!=='string'||label.length>120||/[\x00-\x1f]/.test(label))throw Error('invalid-device-request');
 if(action==='allow')await fictionalAnonymousAccount(uid);
 const before=(await getDocFromServer(doc(db,'members',uid))).data()||null;
 if(action==='revoke'&&!before)throw Error('unknown-device');
 const data={schemaVersion:2,uid,role:'device',authType:'anonymous',status:action==='allow'?'active':'revoked',label:label||before?.label||'',revision:(before?.revision||0)+1};
 const plan={format:marker,version:1,project:PROJECT,planId:crypto.randomUUID(),uid,action,beforeHash:await digest(json(before)),previous:{schemaVersion:before?.schemaVersion??null,status:before?.status??'absent',label:before?.label??'',revision:before?.revision??0},next:data};
 return {...plan,checksum:await digest(plan)};
}
export async function applyDeviceAuthorization(db,plan,confirmation){
 assertAdminLab();assertEmulator(db);const {checksum,...payload}=plan;
 if(plan.format!==marker||plan.version!==1||plan.project!==PROJECT||checksum!==confirmation||checksum!==await digest(payload)||!validUid(plan.uid))throw Error('device-plan-checksum');
 if(!['allow','revoke'].includes(plan.action)||plan.next?.schemaVersion!==2||plan.next.uid!==plan.uid||plan.next.role!=='device'||plan.next.authType!=='anonymous'||plan.next.status!==(plan.action==='allow'?'active':'revoked')||!Number.isSafeInteger(plan.next.revision)||plan.next.revision<1||typeof plan.next.label!=='string'||plan.next.label.length>120||/[\x00-\x1f]/.test(plan.next.label)||Object.keys(plan.next).length!==7)throw Error('device-plan-format');
 if(plan.action==='allow')await fictionalAnonymousAccount(plan.uid);
 const ref=doc(db,'members',plan.uid);
 return runTransaction(db,async tx=>{
  const current=(await tx.get(ref)).data()||null;
  if(current?.lastAdminOperationId===plan.planId){const actual={...current};delete actual.updatedAt;delete actual.lastAdminOperationId;if(await digest(actual)!==await digest(plan.next))throw Error('device-plan-conflict');return {replayed:true};}
  if(await digest(json(current))!==plan.beforeHash)throw Error('device-plan-conflict');
  tx.set(ref,{...plan.next,updatedAt:serverTimestamp(),lastAdminOperationId:plan.planId});return {replayed:false};
 });
}
const json=x=>x==null?x:x.toDate?{timestamp:[x.seconds,x.nanoseconds]}:Array.isArray(x)?x.map(json):typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,json(v)])):x;
