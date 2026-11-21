// Préparation/revue explicites, exclusivement pour des identités de l'Auth Emulator.
import {readFileSync,writeFileSync} from 'node:fs';
import {withAdmin} from '../src/emulator-admin.mjs';
import {prepareDeviceAuthorization,applyDeviceAuthorization} from '../src/device-admin.mjs';
const [action,...args]=process.argv.slice(2);
await withAdmin(async db=>{
 if(['allow','revoke'].includes(action)){
  const [uid,label='',output]=args;if(!output)throw Error('Usage: allow|revoke UID LABEL PLAN.json');
  const plan=await prepareDeviceAuthorization(db,{uid,action,label});writeFileSync(output,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({project:plan.project,uid,action,checksum:plan.checksum,review:output}));
 }else if(action==='apply'){
  const [file,confirmation]=args;const plan=JSON.parse(readFileSync(file,'utf8'));const result=await applyDeviceAuthorization(db,plan,confirmation);console.log(JSON.stringify({uid:plan.uid,status:plan.next.status,...result}));
 }else throw Error('Use allow, revoke or apply. Emulator only.');
});
