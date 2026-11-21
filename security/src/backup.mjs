// Sauvegarde typée et vérifiable des QUATRE collections du contrat familial.
import {Timestamp,Bytes,GeoPoint,DocumentReference,VectorValue,vector,doc,getDocsFromServer,collection,runTransaction} from 'firebase/firestore';
import {PROJECT,digest,assertEmulator,canonical} from './contracts.mjs';
import {assertAdminLab} from './emulator-admin.mjs';
export const COLLECTIONS=['products','shoppingLines','operations','members'];
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function encode(x){
 if(x===null)return ['null'];if(typeof x==='string'||typeof x==='boolean')return [typeof x,x];
 if(typeof x==='number'){if(Number.isInteger(x)&&!Number.isSafeInteger(x))throw Error('unsafe-number');return ['number',Object.is(x,-0)?'-0':String(x)];}
 if(x instanceof Timestamp)return ['timestamp',x.seconds,x.nanoseconds];
 if(x instanceof Bytes)return ['bytes',x.toBase64()];if(x instanceof GeoPoint)return ['geopoint',x.latitude,x.longitude];
 if(x instanceof DocumentReference){if(x.firestore.app.options.projectId!==PROJECT)throw Error('foreign-reference');return ['reference',x.path];}
 if(x instanceof VectorValue)return ['vector',x.toArray()];
 if(Array.isArray(x))return ['array',x.map(encode)];
 if(object(x)&&(Object.getPrototypeOf(x)===Object.prototype||Object.getPrototypeOf(x)===null))return ['map',Object.keys(x).sort().map(k=>[k,encode(x[k])])];
 throw Error('unsupported-firestore-value');
}
export function decode(node,db){
 if(!Array.isArray(node)||typeof node[0]!=='string')throw Error('invalid-typed-value');const [type,a,b]=node;
 if(type==='null'&&node.length===1)return null;
 if(type==='string'&&node.length===2&&typeof a==='string'||type==='boolean'&&node.length===2&&typeof a==='boolean')return a;
 if(type==='number'&&node.length===2&&typeof a==='string'&&(/^[-]?(?:\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/i.test(a)||['NaN','Infinity','-Infinity'].includes(a))){const n=Number(a);if(Number.isInteger(n)&&!Number.isSafeInteger(n))throw Error('unsafe-number');return n;}
 if(type==='timestamp'&&node.length===3&&Number.isInteger(a)&&Number.isInteger(b))return new Timestamp(a,b);
 if(type==='bytes'&&node.length===2&&typeof a==='string'){const result=Bytes.fromBase64String(a);if(result.toBase64()!==a)throw Error('invalid-bytes');return result;}
 if(type==='geopoint'&&node.length===3&&Number.isFinite(a)&&Number.isFinite(b))return new GeoPoint(a,b);
 if(type==='reference'&&node.length===2&&typeof a==='string'&&a.split('/').length%2===0&&a.split('/').every(Boolean)){if(!db)throw Error('reference-requires-database');return doc(db,a);}
 if(type==='vector'&&node.length===2&&Array.isArray(a)&&a.length<=2048&&a.every(Number.isFinite))return vector(a);
 if(type==='array'&&node.length===2&&Array.isArray(a))return a.map(x=>decode(x,db));
 if(type==='map'&&node.length===2&&Array.isArray(a)){
  const seen=new Set(),out={};for(const item of a){if(!Array.isArray(item)||item.length!==2||typeof item[0]!=='string'||seen.has(item[0]))throw Error('invalid-map');seen.add(item[0]);Object.defineProperty(out,item[0],{value:decode(item[1],db),enumerable:true,configurable:true,writable:true});}return out;
 }
 throw Error('invalid-typed-value');
}
export async function snapshot(db){
 assertAdminLab();assertEmulator(db);const data={};for(const name of COLLECTIONS){data[name]=(await getDocsFromServer(collection(db,name))).docs.map(d=>({id:d.id,data:encode(d.data())})).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);}return data;
}
export async function completeBackup(db,metadata={}){
 const first=await snapshot(db),second=await snapshot(db);if(await digest(first)!==await digest(second))throw Error('backup-changed-during-export');return packBackup(second,metadata);
}
export async function packBackup(data,metadata={}){
 if(Object.keys(data).length!==4||COLLECTIONS.some(k=>!Array.isArray(data[k])))throw Error('backup-collections');
 const manifest={};for(const col of COLLECTIONS)manifest[col]={count:data[col].length,sha256:await digest(data[col])};
 const payload={format:'inventaire-family-complete',version:2,project:PROJECT,createdAt:new Date().toISOString(),consistency:'two-identical-scans-requires-maintenance',metadata,data,manifest};return {...payload,checksum:await digest(payload)};
}
export async function verifyBackup(file,db){
 if(!object(file)||file.format!=='inventaire-family-complete'||file.version!==2||file.project!==PROJECT||!object(file.data)||!object(file.manifest))throw Error('backup-format');
 const {checksum,...payload}=file;if(checksum!==await digest(payload))throw Error('backup-checksum');
 if(Object.keys(file.data).length!==4||COLLECTIONS.some(k=>!Array.isArray(file.data[k]))||canonical(Object.keys(file.manifest).sort())!==canonical([...COLLECTIONS].sort()))throw Error('backup-collections');
 let count=0;for(const col of COLLECTIONS){const docs=file.data[col],ids=new Set();if(docs.length!==file.manifest[col].count||await digest(docs)!==file.manifest[col].sha256)throw Error('backup-manifest');
  for(const d of docs){if(!object(d)||Object.keys(d).sort().join()!=='data,id'||typeof d.id!=='string'||!d.id||d.id.includes('/')||ids.has(d.id)||d.data?.[0]!=='map')throw Error('backup-document');ids.add(d.id);if(canonical(encode(decode(d.data,db)))!==canonical(d.data))throw Error('backup-noncanonical');count++;}
 }
 if(count>10000)throw Error('backup-too-large');return {count,checksum};
}
export async function restorePlan(db,backup){
 assertAdminLab();assertEmulator(db);await verifyBackup(backup,db);const current=await snapshot(db),changes=[],conflicts=[],preserved=[];
 for(const col of COLLECTIONS){const source=new Map(backup.data[col].map(d=>[d.id,d]));for(const old of current[col])if(!source.has(old.id))preserved.push({collection:col,id:old.id});
  const target=new Map(current[col].map(d=>[d.id,d.data]));for(const d of backup.data[col]){const exists=target.has(d.id);if(exists&&canonical(target.get(d.id))!==canonical(d.data))conflicts.push({collection:col,id:d.id});else if(!exists)changes.push({collection:col,id:d.id,before:null,after:d.data});}
 }
 return sealPlan({format:'inventaire-admin-data-plan',version:1,project:PROJECT,kind:'restore',planId:crypto.randomUUID(),sourceChecksum:backup.checksum,changes,conflicts,preserved});
}
export async function sealPlan(plan){return {...plan,checksum:await digest(plan)};}
export async function applyDataPlan(db,plan,confirmation){
 assertAdminLab();assertEmulator(db);const {checksum,...payload}=plan;
 if(plan.format!=='inventaire-admin-data-plan'||plan.version!==1||plan.project!==PROJECT||!['restore','migration','rollback'].includes(plan.kind)||checksum!==confirmation||checksum!==await digest(payload))throw Error('plan-checksum');
 if(plan.conflicts.length||plan.changes.length>400)throw Error('plan-blocked');const seen=new Set();for(const c of plan.changes){if(!COLLECTIONS.includes(c.collection)||typeof c.id!=='string'||!c.id||c.id.includes('/')||seen.has(c.collection+'/'+c.id))throw Error('invalid-change');seen.add(c.collection+'/'+c.id);if(plan.kind==='restore'&&(c.before!==null||c.after===null))throw Error('invalid-restore-change');if(plan.kind==='migration'&&(c.after===null||c.collection==='members')||plan.kind==='rollback'&&c.collection==='members')throw Error('invalid-migration-change');for(const value of [c.before,c.after])if(value&&canonical(encode(decode(value,db)))!==canonical(value))throw Error('plan-noncanonical');}
 return runTransaction(db,async tx=>{
  const actual=[];for(const c of plan.changes){const d=await tx.get(doc(db,c.collection,c.id));actual.push(d.exists()?encode(d.data()):null);}
  if(actual.every((d,i)=>canonical(d)===canonical(plan.changes[i].after)))return {replayed:true,writes:0};
  if(actual.some((d,i)=>canonical(d)!==canonical(plan.changes[i].before)))throw Error('data-plan-conflict');
  for(const c of plan.changes){const ref=doc(db,c.collection,c.id);if(c.after===null)tx.delete(ref);else tx.set(ref,decode(c.after,db));}return {replayed:false,writes:plan.changes.length};
 });
}
export async function rollbackPlan(db,migration){
 const {checksum,...payload}=migration;if(checksum!==await digest(payload)||migration.project!==PROJECT||migration.kind!=='migration')throw Error('migration-plan-checksum');
 const changes=migration.changes.map(c=>({...c,before:c.after,after:c.before}));return sealPlan({format:'inventaire-admin-data-plan',version:1,project:PROJECT,kind:'rollback',planId:crypto.randomUUID(),sourceChecksum:checksum,changes,conflicts:[],preserved:[]});
}
