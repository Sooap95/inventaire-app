import {serverTimestamp} from 'firebase/firestore';
import {scopedFirestore} from './scoped-firestore.mjs';
import {TargetPolicyError} from '../../src/preprod/target.js';
import {autoMicros,groupNeedsReview,digest,SyncConflict} from './contracts.mjs';
import {basicWriterCore} from './basic-writer-core.mjs';
import {compactAfter} from './events.mjs';
import {sameCompensationDecision} from './compensation.mjs';
const receipts=['purchase','undoPurchase','purchaseFree','undoPurchaseFree'];
export function familyWriterCore(db,uid,policy){
 const {check,doc,getDocFromServer,runTransaction}=scopedFirestore(db,policy);
 const basic=basicWriterCore(db,uid,policy);
 return async command=>{
  check();
  if(command.actorUid!==uid)throw Error('actor-mismatch');
  if(!receipts.includes(command.action))return basic({...command,eventVersion:2});
  if(command.confirmed!==true)throw Error('explicit-confirmation-required');
  const undo=command.action.startsWith('undo'),free=command.action.endsWith('Free');
  if(command.targetCollection!==(free?'shoppingLines':'products'))throw Error('target-forbidden');
  if(undo&&command.operationId!=='undo_'+command.compensates)throw Error('undo-id');
  const requestHash=await digest(command);
  try{return await runTransaction(db,async tx=>{
   const opRef=doc(db,'operations',command.operationId),oldOp=await tx.get(opRef);
   if(oldOp.exists())return replay(oldOp.data(),command,requestHash,uid);
   const col=free?'shoppingLines':'products',ref=doc(db,col,command.targetId),snapshot=await tx.get(ref),before=snapshot.data();
   if(!before)throw new SyncConflict('target-missing');
   if(before.revision!==command.expectedRevision)throw new SyncConflict();
   const original=undo?(await tx.get(doc(db,'operations',command.compensates))).data():null;
   if(undo&&(!original||original.action!==(free?'purchaseFree':'purchase')||original.targetId!==command.targetId))throw Error('invalid-original-purchase');
   const quantity=undo?original.valueMicros:command.valueMicros;
   if(!Number.isSafeInteger(quantity)||quantity<=0||quantity>1e12||quantity!==command.valueMicros)throw Error('quantity-range');
   let groupRef=free?ref:doc(db,'shoppingLines','product_'+before.id);
   const group=free?before:(await tx.get(groupRef)).data();
   if(!free&&(group?.revision||0)!==command.expectedGroupRevision)throw new SyncConflict('shopping-preview-obsolete');
   if(!undo&&group&&groupNeedsReview(group,free?null:before))throw new SyncConflict('quantity-review-required');
   const applied=undo?(original.receipt.groupId===group?.id?original.receipt.demandMicros:0):Math.min(quantity,group?.totalMicros||0);
   const receipt={groupId:group?.id||null,groupBeforeRevision:group?.revision||0,groupAfterRevision:group?group.revision+1:0,
    demandMicros:applied,compensates:undo?command.compensates:null,
    previousPurchaseId:!free&&!undo?(before.lastPurchaseId||null):null,previousLastRestocked:!free&&!undo?before.lastRestocked:null,
    rollbackPurchaseId:null,rollbackRestocked:null,choiceValueMicros:undo?(command.choiceValueMicros??0):0};
   let after;
   if(!free){
    if(before.deleted)throw new SyncConflict('product-deleted');
    const stockMicros=before.stockMicros+(undo?-quantity:quantity);
    if(stockMicros<0||stockMicros>1e12)throw new SyncConflict('stock-range');
    let lastRestocked=before.lastRestocked,lastPurchaseId=before.lastPurchaseId||null;
    if(!undo){lastRestocked=serverTimestamp();lastPurchaseId=command.operationId;}
    else if(lastPurchaseId===command.compensates){
     let cursor=original,steps=0;lastPurchaseId=cursor.receipt.previousPurchaseId;lastRestocked=cursor.receipt.previousLastRestocked;
     while(lastPurchaseId){
      if(++steps>12)throw new SyncConflict('history-review-required');
      const parent=(await tx.get(doc(db,'operations',lastPurchaseId))).data();
      const cancelled=(await tx.get(doc(db,'operations','undo_'+lastPurchaseId))).exists();
      if(!parent||parent.action!=='purchase'||parent.targetId!==before.id)throw Error('invalid-purchase-chain');
      if(!cancelled){lastRestocked=parent.createdAt;break;}
      cursor=parent;lastPurchaseId=cursor.receipt.previousPurchaseId;lastRestocked=cursor.receipt.previousLastRestocked;
     }
    }
    if(undo){receipt.rollbackPurchaseId=lastPurchaseId;receipt.rollbackRestocked=lastRestocked;}
    after={...before,stockMicros,lastRestocked,lastPurchaseId};
   }
   let groupAfter;
   if(group){
    let totalMicros=group.totalMicros;
    if(!undo)totalMicros-=applied;
    else {
     if(!['keep','set_total','add_extra'].includes(command.choice))throw Error('explicit-shopping-choice-required');
     if(command.choice==='add_extra'&&receipt.choiceValueMicros!==applied)throw Error('invalid-demand-compensation');
     totalMicros=command.choice==='keep'?totalMicros:command.choice==='set_total'?receipt.choiceValueMicros:totalMicros+applied;
    }
    const purchaseNow=Date.now();
    const productAfter=free?null:{...after,lastRestocked:undo?after.lastRestocked:before.lastRestocked};
    // Un achat réapprovisionne maintenant : les suggestions du produit ne peuvent
    // être imminentes pour une fréquence >= 7 jours, sauf fréquence quotidienne.
    if(productAfter&&!undo)productAfter.lastRestocked={toDate:()=>new Date(purchaseNow)};
    groupAfter={...group,totalMicros,fulfilledMicros:(group.fulfilledMicros||0)+(undo?-applied:applied),
     automaticMicros:autoMicros(productAfter,purchaseNow),productRevision:free?0:before.revision+1,needsReview:false,automaticChecked:false,
     revision:group.revision+1,authorUid:uid,updatedAt:serverTimestamp(),lastOperationId:command.operationId};
    if(free)after=groupAfter;
   }else if(undo&&command.choice!=='unchanged')throw Error('unexpected-shopping-choice');
   after={...after,revision:before.revision+1,authorUid:uid,updatedAt:serverTimestamp(),lastOperationId:command.operationId};
   const event={schemaVersion:2,id:command.operationId,authorUid:uid,createdAt:serverTimestamp(),targetCollection:col,targetId:command.targetId,
    beforeRevision:before.revision,afterRevision:after.revision,action:command.action,entryId:null,
    choice:undo?command.choice:'unchanged',valueMicros:quantity,confirmed:true,requestHash,after:compactAfter(after,col),receipt};
   tx.set(ref,after);if(!free&&groupAfter)tx.set(groupRef,groupAfter);tx.set(opRef,event);
   return {replayed:false,revision:after.revision};
  },{maxAttempts:2});}catch(error){
   check();
   if(['permission-denied','aborted'].includes(error.code)){
    try{
     const op=await getDocFromServer(doc(db,'operations',command.operationId));
     if(op.exists())return replay(op.data(),command,requestHash,uid);
     const col=free?'shoppingLines':'products',latest=(await getDocFromServer(doc(db,col,command.targetId))).data();
     if(latest?.revision!==command.expectedRevision)throw new SyncConflict();
     if(!free){const g=(await getDocFromServer(doc(db,'shoppingLines','product_'+command.targetId))).data();if((g?.revision||0)!==command.expectedGroupRevision)throw new SyncConflict('shopping-preview-obsolete');}
    }catch(next){if(next instanceof TargetPolicyError)throw next;if(next instanceof SyncConflict||next.message==='replay-mismatch')throw next;}
   }
   throw error;
  }
 };
}
function replay(event,command,hash,uid){
 if(command.action.startsWith('undo')&&event.receipt?.compensates===command.compensates){
  if(!sameCompensationDecision(event,command))throw new SyncConflict('compensation-decision-conflict');
  return {replayed:true,revision:event.afterRevision,alreadyCompensated:true};
 }
 if(event.requestHash!==hash||event.authorUid!==uid)throw Error('replay-mismatch');
 return {replayed:true,revision:event.afterRevision};
}
