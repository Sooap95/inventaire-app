// A0 uniquement : fichiers locaux -> manifeste JSON. Aucun SDK, fetch ou CLI cloud.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {assertA0Environment,validateProfile} from '../src/preprod/profiles.js';
import {verifyA0Files,verifyA2Files} from './preprod_files.mjs';
import {estimateWeek} from '../src/preprod/diagnostics.js';
const root=fileURLToPath(new URL('../',import.meta.url));
assertA0Environment(process.env);
const args=process.argv.slice(2);
let stage='A0',output=null;const seen=new Set();
for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!['--out','--stage'].includes(flag)||seen.has(flag)||!value||value.startsWith('--'))throw Error('A0_PLAN_ONLY: --stage A2-L / --out NEW_LOCAL_FILE');seen.add(flag);if(flag==='--out')output=value;else {if(!['A0','A2-L'].includes(value))throw Error('UNKNOWN_LOCAL_STAGE');stage=value;}}
const load=p=>JSON.parse(readFileSync(path.join(root,p),'utf8'));
const hashes=stage==='A2-L'?verifyA2Files():verifyA0Files();
const profiles={};for(const [mode,file] of Object.entries({fixture:'fixture.json',emulator:'emulator.json',preprod:'preprod.template.json',production:'production.disabled.json'})){
 const input=load('config/environments/'+file);let validation='valid-local';try{validateProfile(input);}catch(e){validation='blocked:'+e.code;}
 profiles[mode]={file:'config/environments/'+file,origin:input.origin,projectId:input.projectId,validation,cloudExecutable:false};
}
const report={format:'inventaire-preprod-a0-plan',version:1,gate:stage,cloudAuthorized:false,cloudActions:[],profiles,hashes,indexes:load('security/firestore.indexes.json'),resources:{newFirebaseProjects:1,newDefaultFirestoreDatabases:1,newAnonymousAuthProviders:1,newWebApps:1,newCloudflarePagesSites:1,billingAccounts:0,paidServices:0,created:0},blockers:['A1_EXPLICIT_APPROVAL','PROJECT_ID_AND_REGION_UNCHOSEN','SPARK_AND_CURRENT_FREE_LIMITS_UNVERIFIED','A2_EXPLICIT_APPROVAL','PREPROD_ADAPTER_NOT_IMPLEMENTED','A3_EXPLICIT_APPROVAL','REAL_PROJECT_RULES_INDEXES_UNTESTED','REAL_PHONES_UNTESTED'],build:{status:'blocked',fixture:'npm run build:mobile-ui',emulator:'npm run build:family-lab',preprod:'npm run build:preprod (refuses in A0)',cachePrefixPlanned:'inventaire-preprod-',separateOriginsRequired:true,noDeploymentCommands:true},usage:estimateWeek(load('config/environments/usage-week.json'))};
if(stage==='A2-L'){report.resources={created:0,newFirebaseProjects:0,newDatabases:0,newWebApps:0,cloudActionsAuthorized:false};report.target={projectId:'inventaire-v02-preprod-a1',projectNumber:'319106753418',databaseId:'(default)',location:'europe-west6',source:'owner declaration; not independently checked'};report.blockers=['REAL_WEB_CONFIG_NOT_RECEIVED','PREPROD_CLOUD_EXECUTION_DISABLED','CLOUD_CHECK_NOT_AUTHORIZED','PUBLICATION_NOT_AUTHORIZED','REAL_PROJECT_RULES_INDEXES_UNTESTED','REAL_PHONES_UNTESTED'];report.build.status='inactive-local-package-only';report.build.preprod='npm run build:preprod:local';}
const text=JSON.stringify(report,null,2)+'\n';
if(output)writeFileSync(output,text,{flag:'wx'});else process.stdout.write(text);
