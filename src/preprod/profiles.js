// A0 : validation pure, sans SDK, réseau, initialisation Auth ou accès au stockage.
export const PRODUCTION_PROJECT='inventaire-maison-8fd95';
export const ORIGINS=Object.freeze({fixture:'https://inventaire-maison-v02-recette-ui.pages.dev',preprod:'https://inventaire-maison-v02-recette-sync.pages.dev',production:'https://sooap95.github.io'});
const fail=code=>{throw Object.assign(Error(code),{code});};
const keys=(x,list)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===list.length&&list.every(k=>Object.hasOwn(x,k));
const top=['version','mode','origin','projectId','databaseId','firebase','emulators','services'];
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const SERVICES=Object.freeze(['anonymousAuth','firestore']);
export function validateProfile(input){
 if(!keys(input,top)||input.version!==1)fail('profile-format');
 const p=structuredClone(input);
 if(!['fixture','emulator','preprod','production'].includes(p.mode))fail('profile-mode');
 if(p.mode==='production'||p.projectId===PRODUCTION_PROJECT)fail('production-forbidden');
 if(typeof p.projectId!=='string'||!p.projectId)fail('project-required');
 let url;try{url=new URL(p.origin);}catch{fail('origin-invalid');}
 if(url.origin!==p.origin||url.username||url.password)fail('origin-not-canonical');
 if(p.mode==='fixture'){
  if(p.origin!==ORIGINS.fixture||p.projectId!=='ui-fixture-no-firebase'||p.databaseId!==null||p.firebase!==null||p.emulators!==null||!same(p.services,[]))fail('fixture-isolation');
 }else if(p.mode==='emulator'){
  if(p.origin!=='http://127.0.0.1:8769'||p.projectId!=='demo-inventaire-v02'||p.databaseId!=='(default)'||p.firebase!==null||!keys(p.emulators,['auth','firestore'])||p.emulators.auth!=='http://127.0.0.1:9099'||p.emulators.firestore!=='http://127.0.0.1:8180'||!same(p.services,SERVICES))fail('emulator-isolation');
 }else{
  if(!/^inventaire-v02-preprod-[a-z0-9]{2,6}$/.test(p.projectId))fail('preprod-project-name');
  if(p.origin!==ORIGINS.preprod||url.protocol!=='https:'||p.databaseId!=='(default)'||p.emulators!==null||!same(p.services,SERVICES))fail('preprod-isolation');
  if(!keys(p.firebase,['projectNumber','apiKey','appId','authDomain']))fail('firebase-public-config');
  const f=p.firebase;
  if(typeof f.projectNumber!=='string'||!/^\d{6,20}$/.test(f.projectNumber)||typeof f.apiKey!=='string'||!/^AIza[A-Za-z0-9_-]{35}$/.test(f.apiKey)||typeof f.appId!=='string'||!new RegExp('^1:'+f.projectNumber+':web:[a-f0-9]{12,64}$').test(f.appId)||f.authDomain!==p.projectId+'.firebaseapp.com')fail('firebase-project-binding');
 }
 return p;
}
// Une validation de forme n'accorde aucune permission, même avec un profil complet.
export function assertLocalExecution(input,locationOrigin){
 const p=validateProfile(input);
 if(p.mode!=='fixture'&&p.mode!=='emulator')fail('A0_CLOUD_DISABLED');
 if(p.origin!==locationOrigin)fail('runtime-origin-mismatch');
 return p;
}
export function assertA0Environment(env){
 for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN','CLOUDSDK_AUTH_ACCESS_TOKEN','CLOUDFLARE_API_TOKEN'])if(env[key])fail('credentials-forbidden');
 for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(env[key]&&env[key]!=='demo-inventaire-v02')fail('cloud-project-environment-forbidden');
 for(const [key,value] of [['FIRESTORE_EMULATOR_HOST','127.0.0.1:8180'],['FIREBASE_AUTH_EMULATOR_HOST','127.0.0.1:9099']])if(env[key]&&env[key]!==value)fail('emulator-environment-forbidden');
}
