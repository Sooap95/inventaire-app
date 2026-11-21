import {validateQuick} from './quick-stock.js';
// Intentions JSON durables, séparées des snapshots confirmés. Aucun SDK ici.
export const validUid=uid=>typeof uid==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(uid);
export const fresh=uid=>({formatVersion:1,uid,revision:0,cache:{products:[],groups:[]},outbox:[],receipts:[],budget:{since:Date.now(),reads:0,writes:0}});
export const copy=x=>structuredClone(x);
const stable=x=>JSON.stringify(sort(x));
function sort(x){if(Array.isArray(x))return x.map(sort);if(x&&typeof x==='object')return Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])]));return x;}
export function validateCommand(c,uid){
 if(!c||c.actorUid!==uid||!validUid(uid)||c.confirmed!==true||!/^[\w:-]{8,160}$/.test(c.operationId)||!['products','shoppingLines'].includes(c.targetCollection)||typeof c.targetId!=='string'||!c.targetId||!Number.isSafeInteger(c.expectedRevision)||c.expectedRevision<0)throw Error('invalid-command');
 const actions=['product.write','add','edit','remove','review','check','checkAll','init','purchase','purchaseFree','undoPurchase','undoPurchaseFree'];
 if(!actions.includes(c.action))throw Error('invalid-command');
 const quantity=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12;
 if(c.targetId.includes('/')||c.targetId.length>(c.targetCollection==='products'?128:250))throw Error('invalid-command');
 if(c.action==='product.write'){
  const fields=['name','unit','stockMicros','thresholdMicros','targetMicros','frequency','lastRestocked','deleted','details'];
  if(!c.data||typeof c.data!=='object'||Object.keys(c.data).some(k=>!fields.includes(k)))throw Error('invalid-command');
  for(const k of ['stockMicros','thresholdMicros','targetMicros'])if(k in c.data&&!quantity(c.data[k]))throw Error('invalid-command');
 }else if(c.action.toLowerCase().includes('purchase')){
  if(!quantity(c.valueMicros)||c.valueMicros===0||c.action.startsWith('undo')&&c.operationId!=='undo_'+c.compensates)throw Error('invalid-command');
 }else{
  if(!Number.isSafeInteger(c.expectedProductRevision)||c.expectedProductRevision<0||!['keep','set_total','add_extra','unchanged'].includes(c.choice)||!quantity(c.valueMicros))throw Error('invalid-command');
  if(['add','edit','remove'].includes(c.action)&&(!/^[\w:-]{8,160}$/.test(c.entryId)))throw Error('invalid-command');
  if(['add','edit'].includes(c.action)&&(!quantity(c.quantityMicros)||!c.quantityMicros))throw Error('invalid-command');
 }
 if(stable(c).length>40000)throw Error('command-too-large');
 return c;
}
export function validateState(s){
 if(!s||s.formatVersion!==1||!validUid(s.uid)||!Number.isSafeInteger(s.revision)||s.revision<0||!s.cache||!Array.isArray(s.cache.products)||!Array.isArray(s.cache.groups)||!Array.isArray(s.outbox)||!Array.isArray(s.receipts)||!s.budget)throw Error('invalid-backup');
 if(s.outbox.length>5000||s.cache.products.length>2000||s.cache.groups.length>2000||s.receipts.length>1000)throw Error('backup-limit');
 if(!Number.isFinite(s.budget.since)||!Number.isSafeInteger(s.budget.reads)||s.budget.reads<0||!Number.isSafeInteger(s.budget.writes)||s.budget.writes<0)throw Error('invalid-backup');
 const ids=new Set();for(const item of s.outbox){validateCommand(item.command,s.uid);validateQuick(item);if(ids.has(item.command.operationId)||!['pending','sending','ack','conflict','quota','revoked','invalid','held','cancelled'].includes(item.status))throw Error('invalid-backup');ids.add(item.command.operationId);}
 for(const kind of ['products','groups']){const seen=new Set();for(const d of s.cache[kind]){if(!d||typeof d.id!=='string'||seen.has(d.id)||!Number.isSafeInteger(d.revision)||d.revision<1)throw Error('invalid-backup');seen.add(d.id);}}
 return s;
}
export function enqueue(state,commands){
 const next=copy(state);for(const c of commands){validateCommand(c,state.uid);const old=next.outbox.find(i=>i.command.operationId===c.operationId);if(old){if(stable(old.command)!==stable(c))throw Error('operation-identity-conflict');continue;}next.outbox.push({command:copy(c),status:'pending',createdAt:Date.now(),attempts:0});}
 validateState(next);return next;
}
export const enqueueQuick=(state,intent)=>enqueueQuickBatch(state,[intent]);
export function enqueueQuickBatch(state,intents){
 for(const i of intents)validateQuick(i);const next=enqueue(state,intents.map(i=>i.command)),items=new Map(next.outbox.map(i=>[i.command.operationId,i]));
 for(const intent of intents){const item=items.get(intent.command.operationId);if(item.quickStock&&stable(item.quickStock)!==stable(intent.quickStock))throw Error('operation-identity-conflict');item.quickStock=copy(intent.quickStock);}
 validateState(next);return next;
}
// Un échec/quota/conflit empêche les intentions suivantes de dépasser leur aperçu.
export function claim(state,owner,now=Date.now()){
 const next=copy(state),item=next.outbox.find(i=>!['ack','cancelled'].includes(i.status));
 if(!item||!['pending','sending'].includes(item.status)||item.status==='sending'&&item.leaseUntil>now&&item.owner!==owner)return {state:next,item:null};
 Object.assign(item,{status:'sending',owner,leaseUntil:now+30000,attempts:item.attempts+1});return {state:next,item:copy(item)};
}
export function settle(state,operationId,status,owner,code=''){
 const next=copy(state),item=next.outbox.find(i=>i.command.operationId===operationId);if(!item||item.status==='ack')return next;
 if(item.owner&&item.owner!==owner)return next;
 Object.assign(item,{status,code,leaseUntil:0,owner:null});return next;
}
export function classify(error){
 const c=String(error?.code||error?.message||'').replace('firestore/','');
 if(c==='resource-exhausted'||c==='local-budget'||c==='auth/too-many-requests')return 'quota';
 if(c==='device-pending')return 'waiting';
 if(c==='permission-denied'||c==='unauthenticated'||['auth/user-disabled','auth/user-token-expired','auth/invalid-user-token'].includes(c))return 'revoked';
 if(c==='sync-conflict'||c==='aborted'||c==='replay-mismatch')return 'conflict';
 if(['unavailable','deadline-exceeded','offline','auth/network-request-failed','auth/timeout'].includes(c))return 'pending';return 'invalid';
}
export function spend(state,reads,writes,now=Date.now()){
 const next=copy(state);if(now-next.budget.since>=86400000)next.budget={since:now,reads:0,writes:0};
 if(next.budget.reads+reads>10000||next.budget.writes+writes>1000)throw Object.assign(Error('local-budget'),{code:'local-budget'});
 next.budget.reads+=reads;next.budget.writes+=writes;return next;
}
export function exportBackup(state){validateState(state);return {format:'inventaire-family-local',version:1,exportedAt:new Date().toISOString(),state:copy(state)};}
// Aucune donnée du fichier ne devient un stock confirmé. Les snapshots servent
// uniquement à l'aperçu. Les intentions restaurées sont toujours suspendues.
export function planRestore(current,file){
 validateState(current);if(file?.format==='inventaire-family-local'&&file.version===1&&file.state?.uid!==current.uid)throw Error('identity-mismatch');if(!file||file.format!=='inventaire-family-local'||file.version!==1||!file.state||file.state.uid!==current.uid)throw Error('invalid-backup');validateState(file.state);
 const next=copy(current),conflicts=[],added=[];
 for(const incoming of file.state.outbox){const old=next.outbox.find(i=>i.command.operationId===incoming.command.operationId);if(old){if(stable(old.command)!==stable(incoming.command))conflicts.push(incoming.command.operationId);continue;}
  if(['ack','cancelled'].includes(incoming.status))continue;
  next.outbox.push({...copy(incoming),status:'held',owner:null,leaseUntil:0,code:'restore-review'});added.push(incoming.command.operationId);
 }
 return {next,conflicts,added,snapshots:{products:file.state.cache.products.length,groups:file.state.cache.groups.length}};
}
export function retry(state,id){const next=copy(state),i=next.outbox.find(x=>x.command.operationId===id);if(!i||!['pending','quota','held','sending','revoked'].includes(i.status))throw Error('explicit-repreview-required');Object.assign(i,{status:'pending',owner:null,leaseUntil:0,code:''});return next;}
export function cancel(state,id){const next=copy(state),i=next.outbox.find(x=>x.command.operationId===id);if(!i||!['conflict','invalid','held'].includes(i.status))throw Error('cannot-cancel-in-flight');i.status='cancelled';return next;}
