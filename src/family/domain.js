import {autoMicros,groupNeedsReview,historicalProduct,SCALE,toMicros,digest} from '../../security/src/contracts.mjs';
import {convert,normalizeName} from '../shopping/domain.js';
export {SCALE,toMicros};
export function legacy(p){return {...p.legacy,...historicalProduct(p),revision:p.revision,...p.details,lastEditedBy:p.authorUid,restockHistory:p.legacy?.restockHistory||[]};}
export function rows(cache){
 const out=[],seen=new Set();for(const g of cache.groups){
  const p=cache.products.find(p=>p.id===g.productId),a=autoMicros(p),review=groupNeedsReview(g,p),sources=Object.values(g.contributions).filter(c=>c.status==='active');
  const checks=[...(a>0?[g.automaticChecked]:[]),...sources.map(c=>g.checks[c.id]??g.checkAll)];
  const checked=checks.length?checks.every(Boolean):g.checkAll,mixed=checks.some(Boolean)&&!checked;
  out.push({id:g.id,productId:g.productId,name:p&&!p.deleted?p.name:g.name,unit:g.unit,totalMicros:g.totalMicros,automaticMicros:a,review,missing:!!g.productId&&(!p||p.deleted),group:g,product:p,sources,checked,mixed});if(g.productId)seen.add(g.productId);
 }
 for(const p of cache.products)if(!p.deleted&&!seen.has(p.id)&&autoMicros(p)>0)out.push({id:'product_'+p.id,productId:p.id,name:p.name,unit:p.unit,totalMicros:autoMicros(p),automaticMicros:autoMicros(p),product:p,group:null,sources:[],review:false,checked:false,mixed:false});
 return out.sort((a,b)=>a.name.localeCompare(b.name));
}
export function base(uid,col,id,revision,action){return {actorUid:uid,operationId:crypto.randomUUID(),confirmed:true,targetCollection:col,targetId:id,expectedRevision:revision,action};}
export async function addition(uid,row,cache,choice=null){
 if(row.ambiguous||!row.name.trim()||row.name.trim().length>180||!row.unit.trim()||row.unit.length>64)throw Error('ambiguous');const p=row.productId?cache.products.find(p=>p.id===row.productId&&!p.deleted):null;if(row.productId&&!p)throw Error('product-deleted');
 let target=p?'product_'+p.id:'free_'+(await digest([normalizeName(row.name),normalizeName(row.unit)])).slice(0,32);
 if(!p&&!row.distinctFree){
  const named=cache.groups.filter(g=>g.productId===null&&normalizeName(g.name)===normalizeName(row.name));
  const compatible=named.filter(g=>{try{convert(row.quantity,row.unit,g.unit);return true;}catch{return false;}});
  if(compatible.length===1)target=compatible[0].id;
  else if(named.length)throw Error('free-unit-clarification');
 }
 const group=cache.groups.find(g=>g.id===target);if(group&&groupNeedsReview(group,p))throw Error('quantity-review-required');
 const q=toMicros(convert(row.quantity,row.unit,p?.unit||group?.unit||row.unit));if(q<=0)throw Error('quantity-range');
 if(group&&Object.keys(group.contributions||{}).length>=100)throw Error('contribution-limit');
 const current=group?.totalMicros??autoMicros(p);
 if((group||current>0)&&!['keep','set_total','add_extra'].includes(choice))throw Error('explicit-duplicate-choice');
 return {...base(uid,'shoppingLines',target,group?.revision||0,'add'),operationId:row.operationId||crypto.randomUUID(),expectedProductRevision:p?.revision||0,productId:p?.id||null,name:row.name,unit:p?.unit||group?.unit||row.unit,entryId:row.id,quantityMicros:q,choice:choice||'set_total',valueMicros:q};
}
export const groupCommand=(uid,row,action,extra={})=>({...base(uid,'shoppingLines',row.id,row.group?.revision||0,action),expectedProductRevision:row.product?.revision||0,productId:row.productId,entryId:null,...extra});
export function textList(cache,lang='fr'){
 return rows(cache).filter(r=>r.totalMicros>0||r.review).map(r=>`${r.checked?'☑':'☐'} ${r.name} × ${new Intl.NumberFormat(lang,{maximumFractionDigits:6}).format(r.totalMicros/SCALE)} ${r.unit}${r.review?' — '+(lang==='de'?'Menge erneut prüfen':'Quantité à revérifier'):''}`).join('\n');
}
