// Double SDK sans réseau : tests de dérive de cible et de branches de reprise.
export const fault={mode:'normal',transactions:0,callbacks:0,reads:0,recoveryReads:0,queued:0,committed:0};
export function resetFault(mode='normal'){Object.assign(fault,{mode,transactions:0,callbacks:0,reads:0,recoveryReads:0,queued:0,committed:0});}
export const doc=(firestore,col,id)=>({firestore,col,id});
export const collection=(firestore,col)=>({firestore,col});
const snapshot=ref=>({exists:()=>ref.col==='products',data:()=>ref.col==='products'?{schemaVersion:2,id:ref.id,revision:1,name:'Lait fictif',unit:'L',stockMicros:1e6,thresholdMicros:1e6,targetMicros:3e6,frequency:'',lastRestocked:null,deleted:false,legacy:{},createdBy:'fictional-a',authorUid:'fictional-a',lastOperationId:'fictional-seed'}:undefined});
export async function runTransaction(db,fn){
 fault.transactions++;
 if(fault.mode==='recovery-before'){db._settings.host='forbidden.invalid';throw {code:'permission-denied'};}
 if(fault.mode==='recovery-after')throw {code:'permission-denied'};
 const tx={get:async ref=>{fault.reads++;if(fault.mode==='after-get')db._settings.host='forbidden.invalid';return snapshot(ref);},set:()=>{fault.queued++;}};
 fault.callbacks++;const result=await fn(tx);
 if(fault.mode==='retry'){db._settings.host='forbidden.invalid';fault.callbacks++;return fn(tx);}
 fault.committed=fault.queued;return result;
}
export async function getDocFromServer(ref){fault.recoveryReads++;if(fault.mode==='recovery-after')ref.firestore._settings.host='forbidden.invalid';return snapshot(ref);}
export const getDocsFromServer=async()=>({docs:[]});
export const serverTimestamp=()=>({fictionalServerTime:true});
export const Timestamp={fromDate:date=>date};
export const query=(ref,...args)=>({...ref,args});
export const where=(...args)=>args,orderBy=(...args)=>args,limit=n=>n,startAfter=(...args)=>args,documentId=()=>null;
export const onSnapshot=()=>()=>{};
export const enableNetwork=async()=>{},disableNetwork=async()=>{};
