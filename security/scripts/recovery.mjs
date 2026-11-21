// Aucun mode production. Les fichiers sont créés sans écraser un fichier existant.
import {readFileSync,writeFileSync} from 'node:fs';
import {withAdmin} from '../src/emulator-admin.mjs';
import {completeBackup,verifyBackup,restorePlan,applyDataPlan,rollbackPlan} from '../src/backup.mjs';
import {doc,getDocFromServer} from 'firebase/firestore';
import {fictionalAnonymousAccount} from '../src/emulator-admin.mjs';
import {activeDevice} from '../../src/family/membership.js';
import {validateState} from '../../src/family/state.js';
import {auditIdentityBackup} from '../../src/family/recovery.js';
import {historicalMigration} from '../src/historical-migration.mjs';
const [action,...args]=process.argv.slice(2),read=p=>JSON.parse(readFileSync(p,'utf8'));
const write=(p,x)=>{if(!p)throw Error('Output file required');writeFileSync(p,JSON.stringify(x,null,2)+'\n',{flag:'wx'});};
await withAdmin(async db=>{
 if(action==='backup'){const file=await completeBackup(db);write(args[0],file);console.log(JSON.stringify({format:file.format,counts:Object.fromEntries(Object.entries(file.manifest).map(([k,v])=>[k,v.count])),checksum:file.checksum}));}
 else if(action==='verify')console.log(JSON.stringify(await verifyBackup(read(args[0]),db)));
 else if(action==='restore-plan'){const plan=await restorePlan(db,read(args[0]));write(args[1],plan);summary(plan);}
 else if(action==='migration-plan'){const inputs=read(args[1]),manualExports=(inputs.manualFiles||[]).map(p=>readFileSync(p,'utf8'));const plan=await historicalMigration(read(args[0]),{manualExports,totals:inputs.totals||{}},db);write(args[2],plan);summary(plan);}
 else if(action==='rollback-plan'){const plan=await rollbackPlan(db,read(args[0]));write(args[1],plan);summary(plan);}
 else if(action==='identity-audit'){
  const [file,newUid,output,offsetText='0']=args,backup=read(file),offset=Number(offsetText);if(backup.format!=='inventaire-family-local'||backup.version!==1)throw Error('invalid-backup');validateState(backup.state);await fictionalAnonymousAccount(newUid);
  if(!activeDevice((await getDocFromServer(doc(db,'members',newUid))).data(),newUid)||!Number.isSafeInteger(offset)||offset<0)throw Error('authorized-device-and-offset-required');
  const pending=backup.state?.outbox?.filter(i=>!['ack','cancelled'].includes(i.status));if(!pending)throw Error('invalid-backup');const selected=pending.slice(offset,offset+100),events=[];
  for(const item of selected){const event=(await getDocFromServer(doc(db,'operations',item.command.operationId))).data();if(event)events.push(event);}
  const report=await auditIdentityBackup({...backup,state:{...backup.state,outbox:selected}},newUid,events);report.nextOffset=offset+selected.length<pending.length?offset+selected.length:null;write(output,report);console.log(JSON.stringify({reviewOnly:true,count:report.outcomes.length,nextOffset:report.nextOffset}));
 }
 else if(action==='apply'){console.log(JSON.stringify(await applyDataPlan(db,read(args[0]),args[1])));}
 else throw Error('Use backup|verify|restore-plan|migration-plan|rollback-plan|identity-audit|apply. Emulator only.');
});
function summary(p){console.log(JSON.stringify({kind:p.kind,changes:p.changes.length,conflicts:p.conflicts.length,checksum:p.checksum,reviewRequired:true}));}
