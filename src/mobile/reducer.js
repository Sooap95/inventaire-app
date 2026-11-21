// SIMULATION NIVEAU 1. Aucune sécurité ni synchronisation Firebase n'est simulée
// comme une preuve réelle. Le parseur, les commandes et la présentation sont communs.
import {autoMicros,groupNeedsReview,SyncConflict,canonical} from '../../security/src/contracts.mjs';
import {sameCompensationDecision} from '../../security/src/compensation.mjs';
export function fixtureData(){const author='simulation_seed',time='2026-01-01T00:00:00.000Z';return {version:1,revision:0,status:'waiting',products:[['milk','Lait','L',1,1,3],['butter','Beurre','article',0,1,2],['aptamil','Aptamil','boîte',0,1,2],['eggs','œufs','boîte',0,1,1]].map(([id,name,unit,s,t,g])=>({schemaVersion:2,id,revision:1,name,unit,stockMicros:s*1e6,thresholdMicros:t*1e6,targetMicros:g*1e6,frequency:'',lastRestocked:null,deleted:false,legacy:{fixture:true,category:'Alimentation'},createdBy:author,authorUid:author,updatedAt:time,lastOperationId:'simulation_seed_'+id})),groups:[],operations:[]};}
const conflict=message=>{throw new SyncConflict(message);};
export function fixtureApply(input,c,uid,requestHash,time=new Date().toISOString()){
 const state=structuredClone(input);if(state.status!=='active')throw Object.assign(Error('revoked'),{code:'permission-denied'});if(c.actorUid!==uid||!c.confirmed)throw Error('actor-or-confirmation');
 const receipt=state.operations.find(o=>o.id===c.operationId);
 if(receipt){if(c.action.startsWith('undo')&&sameCompensationDecision(receipt,c))return state;if(receipt.requestHash===requestHash&&receipt.authorUid===uid)return state;conflict(c.action.startsWith('undo')?'compensation-decision-conflict':'replay-mismatch');}
 const product=state.products.find(p=>p.id===c.targetId),list=c.targetCollection==='products'?state.products:state.groups,before=list.find(p=>p.id===c.targetId);
 if((before?.revision||0)!==c.expectedRevision)conflict('preview-obsolete');
 const purchase=['purchase','purchaseFree','undoPurchase','undoPurchaseFree'].includes(c.action);let after,auxiliary=null,recordReceipt=null;
 if(purchase){
  const undo=c.action.startsWith('undo'),free=c.action.endsWith('Free');if(!before)conflict('target-missing');if(!free&&before.deleted)conflict('product-deleted');
  const original=undo?state.operations.find(o=>o.id===c.compensates):null;if(undo&&(!original||c.operationId!=='undo_'+original.id||original.action!==(free?'purchaseFree':'purchase')||original.targetId!==c.targetId||c.valueMicros!==original.valueMicros))throw Error('invalid-compensation');
  const group=free?before:state.groups.find(g=>g.id==='product_'+product.id);if(!free&&(group?.revision||0)!==c.expectedGroupRevision)conflict('shopping-preview-obsolete');if(!undo&&group&&groupNeedsReview(group,free?null:product))conflict('quantity-review-required');
  const q=c.valueMicros;if(!Number.isSafeInteger(q)||q<=0)throw Error('quantity');const applied=undo?(original.receipt.groupId===group?.id?original.receipt.demandMicros:0):Math.min(q,group?.totalMicros||0);
  recordReceipt={groupId:group?.id||null,groupBeforeRevision:group?.revision||0,groupAfterRevision:group?group.revision+1:0,demandMicros:applied,compensates:undo?original.id:null,previousPurchaseId:!undo&&!free?product.lastPurchaseId||null:null,previousLastRestocked:!undo&&!free?product.lastRestocked:null,rollbackPurchaseId:null,rollbackRestocked:null,choiceValueMicros:c.choiceValueMicros||0};
  if(!free){const stock=before.stockMicros+(undo?-q:q);if(stock<0||stock>1e12)conflict('stock-range');let lastPurchaseId=undo?before.lastPurchaseId||null:c.operationId,lastRestocked=undo?before.lastRestocked:time;
   if(undo&&lastPurchaseId===original.id){let cursor=original,steps=0;lastPurchaseId=cursor.receipt.previousPurchaseId;lastRestocked=cursor.receipt.previousLastRestocked;while(lastPurchaseId){if(++steps>12)conflict('history-review-required');const p=state.operations.find(o=>o.id===lastPurchaseId);if(!p)throw Error('invalid-history');if(!state.operations.some(o=>o.id==='undo_'+lastPurchaseId)){lastRestocked=p.createdAt;break;}cursor=p;lastPurchaseId=cursor.receipt.previousPurchaseId;lastRestocked=cursor.receipt.previousLastRestocked;}}
   after={...before,stockMicros:stock,lastPurchaseId,lastRestocked};recordReceipt.rollbackPurchaseId=undo?lastPurchaseId:null;recordReceipt.rollbackRestocked=undo?lastRestocked:null;
  }
  if(group){let total=group.totalMicros-applied;if(undo){if(!['keep','set_total','add_extra'].includes(c.choice))throw Error('explicit-choice');if(c.choice==='add_extra'&&c.choiceValueMicros!==applied)throw Error('invalid-demand');total=c.choice==='keep'?group.totalMicros:c.choice==='set_total'?c.choiceValueMicros:group.totalMicros+applied;}
   auxiliary={...group,totalMicros:total,fulfilledMicros:(group.fulfilledMicros||0)+(undo?-applied:applied),productRevision:free?0:before.revision+1,automaticMicros:autoMicros(free?null:after,Date.parse(time)),needsReview:false,automaticChecked:false,revision:group.revision+1,authorUid:uid,updatedAt:time,lastOperationId:c.operationId};if(free)after=auxiliary;
  }
 }else if(c.targetCollection==='products'){
  if(before?.deleted)conflict('product-deleted');if(before&&c.data.unit!==undefined&&c.data.unit!==before.unit)throw Error('unit-locked');after={schemaVersion:2,id:c.targetId,frequency:'',lastRestocked:null,deleted:false,legacy:{},createdBy:uid,...before,...c.data};if(c.data.lastRestocked!==undefined)after.lastPurchaseId=null;
 }else{
  const productId=before?.productId??c.productId??null,p=state.products.find(p=>p.id===productId);if(productId&&(p?.revision||0)!==c.expectedProductRevision)conflict('product-preview-obsolete');
  after=before?structuredClone(before):{schemaVersion:1,id:c.targetId,productId,name:p?.name||c.name,unit:p?.unit||c.unit,contributions:{},checks:{},checkAll:false,automaticChecked:false,automaticMicros:autoMicros(p),productRevision:p?.revision||0,totalMicros:autoMicros(p),needsReview:false};
  const id=c.entryId,old=after.contributions[id];if(['add','edit','review','checkAll'].includes(c.action)&&before&&groupNeedsReview(before,p)&&c.action!=='review')conflict('quantity-review-required');
  if(['add','edit','remove'].includes(c.action)){if(c.action==='add'&&(old||Object.keys(after.contributions).length>=100))throw Error('contribution-limit');if(c.action!=='add'&&old?.status!=='active')conflict('source-missing');after.contributions[id]={id,revision:(old?.revision||0)+1,quantityMicros:c.action==='remove'?old.quantityMicros:c.quantityMicros,status:c.action==='remove'?'removed':c.action==='add'&&c.choice==='keep'?'ignored':'active',createdBy:old?.createdBy||uid,authorUid:uid};if(c.action!=='remove')after.checks[id]=false;}
  if(c.action==='remove')after.needsReview=true;
  if(['add','edit','review'].includes(c.action)){if(!['keep','set_total','add_extra'].includes(c.choice)||c.action==='edit'&&c.choice!=='set_total')throw Error('explicit-choice');if(p?.deleted)conflict('product-deleted');after.totalMicros=c.choice==='keep'?after.totalMicros:c.choice==='set_total'?c.valueMicros:after.totalMicros+c.valueMicros;if(c.action==='review'&&(after.productRevision!==(p?.revision||0)||after.automaticMicros!==autoMicros(p)))after.automaticChecked=false;after.productRevision=p?.revision||0;after.automaticMicros=autoMicros(p);after.needsReview=false;}
  if(c.action==='check'){if(id===null)after.automaticChecked=c.checked;else after.checks[id]=c.checked;}
  if(['init','checkAll'].includes(c.action)){if(c.action==='init'&&before)conflict('already-created');after.checkAll=c.checked;after.automaticChecked=c.checked;after.checks={};}
 }
 for(const key of ['stockMicros','thresholdMicros','targetMicros','totalMicros','fulfilledMicros'])if(after[key]!==undefined&&(!Number.isSafeInteger(after[key])||after[key]<0||after[key]>1e12))throw Error('quantity-range');
 after={...after,revision:(before?.revision||0)+1,authorUid:uid,updatedAt:time,lastOperationId:c.operationId};const index=list.findIndex(p=>p.id===c.targetId);if(index<0)list.push(after);else list[index]=after;
 if(auxiliary&&c.targetCollection==='products'){const i=state.groups.findIndex(g=>g.id===auxiliary.id);state.groups[i]=auxiliary;}
 state.operations.push({schemaVersion:2,id:c.operationId,authorUid:uid,createdAt:time,targetCollection:c.targetCollection,targetId:c.targetId,beforeRevision:c.expectedRevision,afterRevision:after.revision,action:c.action,entryId:c.entryId??null,choice:c.choice||'unchanged',valueMicros:c.valueMicros||0,confirmed:true,requestHash,receipt:recordReceipt});state.revision++;
 return state;
}
export function validateFixture(state){
 if(!state||state.version!==1||!Number.isSafeInteger(state.revision)||state.revision<0||!['active','waiting','revoked'].includes(state.status))throw Error('fixture-format');
 for(const key of ['products','groups','operations']){if(!Array.isArray(state[key])||state[key].length>2000)throw Error('fixture-limit');const ids=new Set();for(const row of state[key]){if(!row||typeof row.id!=='string'||!row.id||row.id.includes('/')||ids.has(row.id))throw Error('fixture-format');ids.add(row.id);}}
 const amount=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12;
 for(const g of state.groups){if(g.schemaVersion!==1||typeof g.name!=='string'||!g.name||typeof g.unit!=='string'||!g.unit||!Number.isSafeInteger(g.revision)||g.revision<1||!amount(g.totalMicros)||!amount(g.automaticMicros)||!amount(g.fulfilledMicros||0)||!g.contributions||!g.checks||Object.keys(g.contributions).length>100||typeof g.needsReview!=='boolean'||typeof g.checkAll!=='boolean'||typeof g.automaticChecked!=='boolean')throw Error('fixture-format');for(const [id,c]of Object.entries(g.contributions))if(c.id!==id||!amount(c.quantityMicros)||c.quantityMicros===0||!Number.isSafeInteger(c.revision)||c.revision<1||!['active','ignored','removed'].includes(c.status))throw Error('fixture-format');for(const [id,value]of Object.entries(g.checks))if(!Object.hasOwn(g.contributions,id)||typeof value!=='boolean')throw Error('fixture-format');}
 for(const op of state.operations)if(op.schemaVersion!==2||!['products','shoppingLines'].includes(op.targetCollection)||typeof op.targetId!=='string'||typeof op.authorUid!=='string'||!['product.write','add','edit','remove','review','check','checkAll','init','purchase','purchaseFree','undoPurchase','undoPurchaseFree'].includes(op.action)||!Number.isSafeInteger(op.beforeRevision)||op.afterRevision!==op.beforeRevision+1||!amount(op.valueMicros)||Number.isNaN(Date.parse(op.createdAt)))throw Error('fixture-format');
 for(const p of state.products){if(p.schemaVersion!==2||typeof p.name!=='string'||!p.name||typeof p.unit!=='string'||!p.unit||!Number.isSafeInteger(p.revision))throw Error('fixture-format');for(const k of ['stockMicros','thresholdMicros','targetMicros'])if(!Number.isSafeInteger(p[k])||p[k]<0||p[k]>1e12)throw Error('fixture-format');}
 return state;
}
export function fixtureRestore(current,file){
 if(file?.format!=='inventaire-mobile-fixture'||file.version!==1)throw Error('fixture-format');validateFixture(file.data);validateFixture(current);const next=structuredClone(current),conflicts=[],added=[];
 for(const col of ['products','groups','operations'])for(const row of file.data[col]){const old=current[col].find(d=>d.id===row.id);if(old){if(canonical(old)!==canonical(row))conflicts.push({col,id:row.id});}else{next[col].push(structuredClone(row));added.push({col,id:row.id});}}
 return {next,conflicts,added};
}
