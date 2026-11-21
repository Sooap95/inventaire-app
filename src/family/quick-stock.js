// Ajustements +/- : métadonnées LOCALES. Les commandes Firestore restent product.write.
const MAX=1e12,STEP=1e6,terminal=new Set(['ack','cancelled']);
const fail=code=>{throw Object.assign(Error(code),{code});};
const amount=x=>Number.isSafeInteger(x)&&x>=0&&x<=MAX;
const apply=(n,steps)=>steps.reduce((q,d)=>{const value=Math.max(0,q+d);if(!amount(value))fail('quantity-range');return value;},n);
export function validateQuick(item){
 const q=item.quickStock,c=item.command;
 if(!q)return item;
 if(q.version!==1||!amount(q.beforeStockMicros)||typeof q.unit!=='string'||!q.unit||q.unit.length>64||!Array.isArray(q.steps)||!q.steps.length||q.steps.length>5000||q.steps.some(d=>d!==STEP&&d!==-STEP)||!Array.isArray(q.replaces)||q.replaces.length>5000||q.replaces.some(id=>typeof id!=='string'||!/^[\w:-]{8,160}$/.test(id))||c.action!=='product.write'||c.targetCollection!=='products'||!c.data||Object.keys(c.data).length!==1||!amount(c.data.stockMicros)||apply(q.beforeStockMicros,q.steps)!==c.data.stockMicros)fail('invalid-quick-stock');
 return item;
}
export function quickItems(state,id,volatile=[]){
 const items=[...(state?.outbox||[])],ids=new Set(items.map(i=>i.command.operationId));
 for(const i of volatile)if(!ids.has(i.command.operationId)){items.push(i);ids.add(i.command.operationId);}
 return items.filter(i=>i.quickStock&&i.command.targetId===id&&i.status!=='cancelled');
}
export function quickView(state,id,volatile=[]){
 const p=state?.cache.products.find(p=>p.id===id);if(!p||p.deleted)return null;
 const items=quickItems(state,id,volatile),unresolved=items.filter(i=>!terminal.has(i.status));
 const other=state.outbox.some(i=>!terminal.has(i.status)&&!i.quickStock&&i.command.targetCollection==='products'&&i.command.targetId===id);
 let stock=p.stockMicros,revision=p.revision,blocked=other?'other-operation':null,waiting=0;
 for(const i of items){
  validateQuick(i);const c=i.command,q=i.quickStock;
  if(!terminal.has(i.status)&&!['pending','sending','saving'].includes(i.status))blocked=i.status;
  if(c.expectedRevision+1<=p.revision){
   if(i.status!=='ack'&&!(p.revision===c.expectedRevision+1&&p.lastOperationId===c.operationId))blocked=blocked||'context-changed';
   continue;
  }
  if(c.expectedRevision!==revision||q.beforeStockMicros!==stock||q.unit!==p.unit)blocked=blocked||'context-changed';
  else {stock=c.data.stockMicros;revision++;waiting+=q.steps.length;}
 }
 const count=unresolved.reduce((n,i)=>n+i.quickStock.steps.length,0);
 return {id,confirmedMicros:p.stockMicros,displayMicros:blocked?p.stockMicros:stock,revision,unit:p.unit,blocked,pending:count||waiting,count,storageReason:unresolved.find(i=>i.status==='storage')?.storageReason,saving:items.some(i=>i.status==='saving'),items:unresolved};
}
export function quickIntent(state,id,delta,operationId,volatile=[]){
 if(delta!==1&&delta!==-1)fail('invalid-quick-step');const view=quickView(state,id,volatile);
 if(!view)fail('product-missing');if(view.blocked)fail('quick-review-required');
 const next=Math.max(0,view.displayMicros+delta*STEP);if(next>MAX)fail('quantity-range');if(next===view.displayMicros)return null;
 return {command:{actorUid:state.uid,operationId,confirmed:true,targetCollection:'products',targetId:id,expectedRevision:view.revision,action:'product.write',data:{stockMicros:next}},quickStock:{version:1,beforeStockMicros:view.displayMicros,steps:[delta*STEP],unit:view.unit,replaces:[]},status:'saving'};
}
const context=(state,id)=>JSON.stringify([state.uid,state.cache.products.find(p=>p.id===id),state.outbox.filter(i=>i.command.targetCollection==='products'&&i.command.targetId===id)]);
export function quickReviewPlan(state,id,product,acknowledged,replacementId){
 const items=quickItems(state,id).filter(i=>!terminal.has(i.status));
 if(!items.length||items.some(i=>i.status==='sending')||!items.some(i=>['conflict','invalid','held'].includes(i.status)))fail('quick-review-required');
 if(!product||product.id!==id||product.revision<(state.cache.products.find(p=>p.id===id)?.revision||0))fail('quick-review-stale');
 if(state.outbox.some(i=>!terminal.has(i.status)&&!i.quickStock&&i.command.targetCollection==='products'&&i.command.targetId===id))fail('quick-review-required');
 let blocked=product.deleted?'product-deleted':items.some(i=>i.quickStock.unit!==product.unit)?'unit-changed':null;
 const known=new Set(acknowledged),remaining=items.filter(i=>!known.has(i.command.operationId)),steps=remaining.flatMap(i=>i.quickStock.steps);let total=product.stockMicros;if(!blocked){try{total=apply(product.stockMicros,steps);}catch{blocked='quantity-range';}}
 if(!amount(total))fail('quantity-range');
 const replacement=!blocked&&steps.length&&total!==product.stockMicros?{command:{actorUid:state.uid,operationId:replacementId,confirmed:true,targetCollection:'products',targetId:id,expectedRevision:product.revision,action:'product.write',data:{stockMicros:total}},quickStock:{version:1,beforeStockMicros:product.stockMicros,steps,unit:product.unit,replaces:remaining.map(i=>i.command.operationId)},status:'pending',createdAt:Date.now(),attempts:0}:null;
 if(replacement)validateQuick(replacement);
 return {id,blocked,context:context(state,id),product:structuredClone(product),ids:items.map(i=>i.command.operationId),acknowledged:[...known],count:steps.length,totalMicros:total,replacement};
}
export function applyQuickReview(state,plan,keep=false){
 if(context(state,plan.id)!==plan.context)fail('quick-review-stale');if(plan.blocked&&!keep)fail('quick-review-required');const next=structuredClone(state),known=new Set(plan.acknowledged);
 next.cache.products=next.cache.products.map(p=>p.id===plan.id?structuredClone(plan.product):p);
 for(const i of next.outbox)if(plan.ids.includes(i.command.operationId))Object.assign(i,{status:known.has(i.command.operationId)?'ack':'cancelled',code:known.has(i.command.operationId)?'':'quick-reviewed',leaseUntil:0,owner:null});
 if(!keep&&plan.replacement)next.outbox.push(structuredClone(plan.replacement));
 return next;
}
// Réserve chaque appui immédiatement en mémoire, puis le persiste en ordre sans
// attendre le réseau. Un échec disque conserve les appuis et arrête le drainage.
export function quickBuffer({getState,persist,flush,changed=()=>{}}){
 const volatile=[];let draining=false,error=null;
 async function drain(){if(draining||error)return;draining=true;
  try{while(volatile.length){const batch=volatile.slice();try{await persist(batch);}catch(e){error=e;for(const i of volatile){i.status='storage';i.storageReason=e?.code||e?.message;i.reject(e);}changed();break;}volatile.splice(0,batch.length);for(const i of batch)i.resolve(i.command.operationId);changed();Promise.resolve().then(flush).catch(()=>changed('flush-error'));}}
  finally{draining=false;}
 }
 return {volatile,get error(){return error;},capture(id,delta,operationId){
  if(error)fail('quick-storage');const i=quickIntent(getState(),id,delta,operationId,volatile);if(!i){changed('zero',id);return Promise.resolve(null);}
  const result=new Promise((resolve,reject)=>Object.assign(i,{resolve,reject}));volatile.push(i);changed();void drain();return result;
 },retry(){error=null;for(const i of volatile)if(i.status==='storage'){i.status='saving';delete i.storageReason;}changed();void drain();}};
}
