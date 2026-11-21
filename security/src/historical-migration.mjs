// Préparation uniquement. L'application de ce plan reste limitée à l'émulateur.
import {createHash} from 'node:crypto';
import {Timestamp} from 'firebase/firestore';
import {verifyBackup,decode,encode,sealPlan} from './backup.mjs';
import {PROJECT,digest,toMicros,autoMicros} from './contracts.mjs';
import {readBackup} from '../../src/shopping/backup.js';
import {active,project,convert} from '../../src/shopping/domain.js';
const operator='migration-admin-fictional';
export async function historicalMigration(backup,{manualExports=[],totals={},preparedAt=Date.now()}={},db){
 await verifyBackup(backup,db);const changes=[],conflicts=[],warnings=[],groupsToReview=[],products=[];
 const stamp=Timestamp.fromMillis(preparedAt),planId='migration_'+crypto.randomUUID();
 for(const item of backup.data.products){
  try{
   const raw=decode(item.data,db);if(raw.schemaVersion===2||'stockMicros'in raw)throw Error('already-canonical-review-required');
   if(raw.id!==undefined&&raw.id!==item.id)throw Error('document-id-mismatch');
   if(item.id.length>128||!item.id.trim())throw Error('product-id-invalid');
   if(typeof raw.name!=='string'||!raw.name.trim()||raw.name.length>180||typeof raw.unit!=='string'||!raw.unit.trim()||raw.unit.length>64)throw Error('name-unit-review-required');
   if(!['','quotidien','hebdomadaire','mensuel','trimestriel'].includes(raw.frequency||''))throw Error('frequency-review-required');
   if(raw.lastRestocked!=null&&(typeof raw.lastRestocked!=='string'||Number.isNaN(Date.parse(raw.lastRestocked))))throw Error('date-review-required');
   const p={schemaVersion:2,id:item.id,revision:1,name:raw.name,unit:raw.unit,stockMicros:toMicros(raw.stock),thresholdMicros:toMicros(raw.threshold),targetMicros:toMicros(raw.target),frequency:raw.frequency||'',lastRestocked:raw.lastRestocked?Timestamp.fromDate(new Date(raw.lastRestocked)):null,deleted:false,legacy:raw,createdBy:operator,authorUid:operator,updatedAt:stamp,lastOperationId:planId};
   if(Buffer.byteLength(JSON.stringify(encode(p)))>700000)throw Error('document-size-review-required');
   products.push(p);changes.push({collection:'products',id:item.id,before:item.data,after:encode(p)});if(raw.id===undefined)warnings.push({id:item.id,code:'embedded-id-from-document-path'});
  }catch(e){conflicts.push({collection:'products',id:item.id,code:e.message});}
 }
 const sourceHashes=new Set();
 const groupIds=new Set(backup.data.shoppingLines.map(d=>d.id));
 for(const rawText of manualExports){
  let file;try{file=readBackup(rawText);}catch(e){conflicts.push({code:'manual-backup-invalid'});continue;}
  const sourceHash=createHash('sha256').update(rawText).digest('hex');if(sourceHashes.has(sourceHash)){conflicts.push({code:'duplicate-source-backup'});continue;}sourceHashes.add(sourceHash);const legacy=products.map(p=>({...p.legacy,id:p.id}));
  for(const line of file.state.lines){
   if(!active(line).length)continue;
   const id=line.productId?'product_'+line.productId:'free_'+(await digest(line.id)).slice(0,32);
   try{
    if(groupIds.has(id))throw Error('multiple-sources-explicit-reconciliation-required');groupIds.add(id);
    if(active(line).length>100)throw Error('contribution-limit');
    const p=products.find(p=>p.id===line.productId);if(line.productId&&!p)throw Error('missing-product');if(p&&p.unit!==line.unit)throw Error('unit-review-required');
    const view=project(line,legacy,preparedAt);const choice=totals[id];groupsToReview.push({id,sourceHash,proposedTotalMicros:toMicros(view.quantity),automaticMicros:autoMicros(p,preparedAt),needsReview:view.needsReview});
    if(!choice||choice.sourceHash!==sourceHash||choice.choice!=='set_total'||!Number.isSafeInteger(choice.totalMicros)||choice.totalMicros<0||choice.totalMicros>1e12)throw Error('explicit-final-total-required');
    const contributions=Object.create(null),checks=Object.create(null);for(const c of active(line)){if(!/^[A-Za-z0-9:_-]{8,160}$/.test(c.id)||Object.hasOwn(contributions,c.id))throw Error('contribution-id-conflict');contributions[c.id]={id:c.id,revision:c.revision,quantityMicros:toMicros(convert(c.quantity,c.unit,line.unit)),status:'active',createdBy:operator,authorUid:operator};checks[c.id]=c.checked;}
    const group={schemaVersion:1,id,revision:1,productId:line.productId,name:p?.name||line.name,unit:line.unit,contributions,checks,checkAll:false,automaticChecked:false,automaticMicros:autoMicros(p,preparedAt),productRevision:p?.revision||0,totalMicros:choice.totalMicros,fulfilledMicros:0,needsReview:false,authorUid:operator,updatedAt:stamp,lastOperationId:planId};
    changes.push({collection:'shoppingLines',id,before:null,after:encode(group)});
   }catch(e){conflicts.push({collection:'shoppingLines',id,code:e.message});}
  }
  // Le texte exact préserve versions retirées, décisions, alias et auteurs locaux.
  const bytes=Buffer.from(rawText),partCount=Math.ceil(bytes.length/180000)||1;
  for(let partIndex=0;partIndex<partCount;partIndex++){
   const id='migration_'+sourceHash+'_'+partIndex;if(backup.data.operations.some(d=>d.id===id)){conflicts.push({collection:'operations',id,code:'archive-already-exists'});continue;}
   const event={schemaVersion:1,kind:'migration.archive',id,sourceHash,partIndex,partCount,encoding:'base64',payload:bytes.subarray(partIndex*180000,(partIndex+1)*180000).toString('base64'),administrativeAuthorUid:operator,createdAt:stamp};changes.push({collection:'operations',id,before:null,after:encode(event)});
  }
 }
 if(backup.data.operations.some(d=>d.id===planId))conflicts.push({code:'migration-id-conflict'});
 changes.push({collection:'operations',id:planId,before:null,after:encode({schemaVersion:1,kind:'migration.record',id:planId,sourceChecksum:backup.checksum,administrativeAuthorUid:operator,createdAt:stamp,groupDecisions:totals})});
 return sealPlan({format:'inventaire-admin-data-plan',version:1,project:PROJECT,kind:'migration',planId,sourceChecksum:backup.checksum,changes,conflicts,warnings,groupsToReview,preserved:['members','unrelated-operations','unrelated-shoppingLines']});
}
