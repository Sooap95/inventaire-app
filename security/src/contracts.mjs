import '../../src/domain/stock.js';
export const PROJECT='demo-inventaire-v02';
export const EMULATOR='127.0.0.1:8180';
export const SCALE=1000000;
export class SyncConflict extends Error {constructor(message='preview-obsolete'){super(message);this.code='sync-conflict';}}
export function toMicros(value){
 const s=String(value).replace(',','.');if(!/^\d+(?:\.\d{1,6})?$/.test(s))throw Error('precision-requires-review');
 const [a,b='']=s.split('.'),n=BigInt(a)*1000000n+BigInt(b.padEnd(6,'0'));
 if(n>1000000000000n)throw Error('quantity-range');return Number(n);
}
export function timestampISO(value){
 if(value==null)return undefined;
 if(typeof value==='string')return value;
 return value.toDate?value.toDate().toISOString():new Date(value.seconds*1000+(value.nanoseconds||0)/1000000).toISOString();
}
export function historicalProduct(p){return {id:p.id,name:p.name,unit:p.unit,stock:p.stockMicros/SCALE,
 threshold:p.thresholdMicros/SCALE,target:p.targetMicros/SCALE,frequency:p.frequency,
 lastRestocked:timestampISO(p.lastRestocked)};}
export function autoMicros(p,now=Date.now()){
 if(!p||p.deleted)return 0;const old=historicalProduct(p),stock=globalThis.InventoryStock;
 return stock.getStatus(old)!=='ok'||stock.isSuggested(old,now)?Math.max(0,p.targetMicros-p.stockMicros):0;
}
export function groupNeedsReview(group,product,now=Date.now()){
 return !!(group.needsReview || group.productId && (!product || product.deleted
  || group.productRevision!==product.revision || group.automaticMicros!==autoMicros(product,now)));
}
export function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value))))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function assertEmulator(db){
 const instance=db?._delegate||db;
 if(instance?.app?.options?.projectId!==PROJECT||instance?._settings?.host!==EMULATOR||instance?._settings?.ssl!==false)throw Error('EMULATOR_ONLY: unexpected project or host');
}
