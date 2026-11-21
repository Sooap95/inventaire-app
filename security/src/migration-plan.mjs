// Plan sans I/O réseau ni écriture : pas d'adaptateur Firebase importé ici.
import {readBackup} from '../../src/shopping/backup.js';
import {active,project,convert} from '../../src/shopping/domain.js';
import {toMicros} from './contracts.mjs';
const bytes=text=>new TextEncoder().encode(text);
async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function migrationPlan(manualRaw,products,operatorUid){
 if(typeof operatorUid!=='string'||!operatorUid.trim()||operatorUid.length>128)throw Error('administrative-operator-required');
 if(!Array.isArray(products))throw Error('product-array-required');
 const file=readBackup(manualRaw),sourceHash=await hash(manualRaw),issues=[],proposals=[],groups=[],ids=new Set();
 for(const p of products){
  try{
   if(typeof p.id!=='string'||!p.id.trim()||p.id.includes('/')||p.id.length>128||ids.has(p.id))throw Error('product-id-conflict');
   ids.add(p.id);
   if(typeof p.unit!=='string'||!p.unit.trim()||p.unit.length>64)throw Error('unit-requires-review');
   if(typeof p.name!=='string'||!p.name.trim()||p.name.length>180)throw Error('name-requires-review');
   const frequency=p.frequency||'';
   if(!['','quotidien','hebdomadaire','mensuel','trimestriel'].includes(frequency))throw Error('frequency-requires-review');
   const lastRestocked=p.lastRestocked?new Date(p.lastRestocked):null;
   if(lastRestocked&&Number.isNaN(lastRestocked.getTime()))throw Error('date-requires-review');
   const legacy=structuredClone(p);
   if(bytes(JSON.stringify(legacy)).length>250000)throw Error('legacy-size-requires-archive');
   proposals.push({id:p.id,name:p.name,unit:p.unit,stockMicros:toMicros(p.stock),thresholdMicros:toMicros(p.threshold),targetMicros:toMicros(p.target),
    frequency,lastRestockedISO:lastRestocked?.toISOString()||null,legacy,requiresApproval:true});
  }catch(error){issues.push({type:error.message,productId:p.id??null});}
 }
 for(const line of file.state.lines){
  if(!active(line).length)continue;
  const targetId=line.productId?'product_'+line.productId:'free_'+(await hash(line.id)).slice(0,32);
  const item={localGroupId:line.id,targetId,productId:line.productId,name:line.name,unit:line.unit,
   requiresApproval:true,requiresQuantityReview:true,contributions:[]};
  try{
   if(active(line).length>100)throw Error('contribution-cap-requires-review');
   if(line.productId&&!products.some(p=>p.id===line.productId))throw Error('deleted-product-requires-resolution');
   const p=products.find(p=>p.id===line.productId);
   if(p&&p.unit!==line.unit)throw Error('unit-requires-review');
   const view=project(line,products);item.requiresQuantityReview=!!view.needsReview;
   item.proposedTotalMicros=toMicros(view.quantity);
   item.contributions=active(line).map(c=>({id:c.id,localRevision:c.revision,quantityMicros:toMicros(convert(c.quantity,c.unit,line.unit)),checked:c.checked}));
  }catch(error){issues.push({type:error.message,localGroupId:line.id});}
  groups.push(item);
 }
 // L'archive conserve toutes les décisions/versions, y compris inactives et les
 // anciens noms locaux qui ne sont jamais considérés comme des UID authentifiés.
 const rawBytes=bytes(manualRaw),chunkSize=180000,partCount=Math.max(1,Math.ceil(rawBytes.length/chunkSize));
 const archives=Array.from({length:partCount},(_,partIndex)=>({id:`migration_${sourceHash}_${partIndex}`,schemaVersion:1,kind:'migration.archive',
  sourceHash,partIndex,partCount,encoding:'base64',payload:Buffer.from(rawBytes.slice(partIndex*chunkSize,(partIndex+1)*chunkSize)).toString('base64'),
  administrativeAuthorUid:operatorUid,requiresApproval:true}));
 return {mode:'dry-run-only',readyForProduction:false,sourceHash,operatorUid,products:proposals,groups,archives,issues,
  aliasesRemainLocal:structuredClone(file.state.aliases),requiresAdministrativeReview:true};
}
