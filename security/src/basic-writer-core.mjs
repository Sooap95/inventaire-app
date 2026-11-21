// Transactions métier communes, obligatoirement liées à une politique de cible.
import {serverTimestamp,Timestamp} from 'firebase/firestore';
import {scopedFirestore} from './scoped-firestore.mjs';
import {TargetPolicyError} from '../../src/preprod/target.js';
import {autoMicros,digest,SyncConflict} from './contracts.mjs';
import {compactAfter} from './events.mjs';
export function basicWriterCore(db,uid,policy){
 const {check,doc,getDocFromServer,runTransaction}=scopedFirestore(db,policy);
 return async command=>{
  check();
  if(command.confirmed!==true)throw Error('explicit-confirmation-required');
  if(!['products','shoppingLines'].includes(command.targetCollection))throw Error('target-forbidden');
  const requestHash=await digest(command);
  return runTransaction(db,async tx=>{
   const eventRef=doc(db,'operations',command.operationId),previous=await tx.get(eventRef);
   if(previous.exists()){
    if(previous.data().requestHash!==requestHash||previous.data().authorUid!==uid)throw Error('replay-mismatch');
    return {replayed:true,revision:previous.data().afterRevision};
   }
   const targetRef=doc(db,command.targetCollection,command.targetId),snapshot=await tx.get(targetRef),before=snapshot.exists()?snapshot.data():null;
   if((before?.revision||0)!==command.expectedRevision)throw new SyncConflict();
   let after;
   if(command.targetCollection==='products'){
    const fields=['name','unit','stockMicros','thresholdMicros','targetMicros','frequency','lastRestocked','deleted','details'];
    if(Object.keys(command.data).some(k=>!fields.includes(k)))throw Error('product-fields');
    const data={...command.data};
    if(typeof data.lastRestocked==='string')data.lastRestocked=Timestamp.fromDate(new Date(data.lastRestocked));
    after={schemaVersion:2,id:command.targetId,createdBy:uid,frequency:'',lastRestocked:null,deleted:false,legacy:{},...before,...data};
    if(Object.hasOwn(data,'lastRestocked')&&before&&data.lastRestocked!==before.lastRestocked)after.lastPurchaseId=null;
   }else{
    const productId=before?before.productId:command.productId??null;
    const p=productId?(await tx.get(doc(db,'products',productId))).data():null;
    if(productId&&(p?.revision||0)!==command.expectedProductRevision)throw new SyncConflict('product-preview-obsolete');
    after=before?{...before,contributions:{...before.contributions},checks:{...before.checks}}:
     {schemaVersion:1,id:command.targetId,productId,name:p?.name||command.name,unit:p?.unit||command.unit,
      contributions:{},checks:{},checkAll:false,automaticChecked:false,automaticMicros:autoMicros(p),productRevision:p?.revision||0,
      totalMicros:autoMicros(p),needsReview:false};
    const id=command.entryId,old=before?.contributions[id];
    if(['add','edit','remove'].includes(command.action)){
     after.contributions[id]={id,revision:(old?.revision||0)+1,quantityMicros:command.action==='remove'?old.quantityMicros:command.quantityMicros,
      status:command.action==='remove'?'removed':command.action==='add'&&command.choice==='keep'?'ignored':'active',
      createdBy:old?.createdBy||uid,authorUid:uid};
     if(command.action!=='remove')after.checks[id]=false;
    }
    if(command.action==='remove')after.needsReview=true;
    if(['add','edit','review'].includes(command.action)){
     const newAutomatic=autoMicros(p);
     if(command.action==='review'&&(after.productRevision!==(p?.revision||0)||after.automaticMicros!==newAutomatic))after.automaticChecked=false;
     after.totalMicros=command.choice==='keep'?after.totalMicros:command.choice==='set_total'?command.valueMicros:after.totalMicros+command.valueMicros;
     after.productRevision=p?.revision||0;after.automaticMicros=newAutomatic;after.needsReview=false;
    }
    if(command.action==='check'){
     if(id===null)after.automaticChecked=command.checked;else after.checks[id]=command.checked;
    }
    if(command.action==='init'){if(before)throw new SyncConflict();after.checkAll=command.checked;after.automaticChecked=command.checked;}
    if(command.action==='checkAll'){after.checkAll=command.checked;after.automaticChecked=command.checked;after.checks={};}
   }
   after={...after,revision:(before?.revision||0)+1,authorUid:uid,updatedAt:serverTimestamp(),lastOperationId:command.operationId};
   const v2=command.eventVersion===2;
   const operation={schemaVersion:v2?2:1,id:command.operationId,authorUid:uid,createdAt:serverTimestamp(),
    targetCollection:command.targetCollection,targetId:command.targetId,beforeRevision:before?.revision||0,afterRevision:after.revision,
    action:command.action,entryId:command.entryId??null,choice:command.choice??'unchanged',valueMicros:command.valueMicros??0,
    confirmed:true,requestHash,after:v2?compactAfter(after,command.targetCollection,command.entryId,command.action):after,
    ...(v2?{receipt:null}:{})};
   tx.set(targetRef,after);tx.set(eventRef,operation);return {replayed:false,revision:after.revision};
  },{maxAttempts:5}).catch(async error=>{
   check();
   // Certains conflits sont évalués par les règles avant la précondition de
   // transaction et arrivent en permission-denied. Ne jamais réécrire ici.
   if(['permission-denied','aborted'].includes(error.code)){
    try{
     const event=await getDocFromServer(doc(db,'operations',command.operationId));
     if(event.exists()){
      if(event.data().requestHash!==requestHash||event.data().authorUid!==uid)throw Error('replay-mismatch');
      return {replayed:true,revision:event.data().afterRevision};
     }
     const latest=await getDocFromServer(doc(db,command.targetCollection,command.targetId));
     if((latest.data()?.revision||0)!==command.expectedRevision)throw new SyncConflict();
     const productId=command.targetCollection==='shoppingLines'?(latest.data()?.productId||command.productId):null;
     if(productId){
      const product=await getDocFromServer(doc(db,'products',productId));
      if((product.data()?.revision||0)!==command.expectedProductRevision)throw new SyncConflict('product-preview-obsolete');
     }
    }catch(readError){if(readError instanceof TargetPolicyError)throw readError;if(readError instanceof SyncConflict||readError.message==='replay-mismatch')throw readError;}
   }
   throw error;
  });
 };
}
