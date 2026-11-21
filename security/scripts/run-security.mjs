import {readFileSync,mkdirSync,openSync,closeSync,existsSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),project='demo-inventaire-v02',host='127.0.0.1',port=8180;
for(const key of ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN'])if(process.env[key])throw Error('Credentials are forbidden for this fictional test');
for(const key of ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT'])if(process.env[key]&&process.env[key]!==project)throw Error('Only the demo project is permitted');
if(process.env.FIRESTORE_EMULATOR_HOST&&process.env.FIRESTORE_EMULATOR_HOST!==`${host}:${port}`)throw Error('Unexpected emulator endpoint');
const config=JSON.parse(readFileSync(path.join(root,'firebase.emulator.json')));
if(config.emulators.auth?.host!=='127.0.0.1'||config.emulators.auth.port!==9099)throw Error('Unexpected Auth emulator');
if(config.emulators.firestore.host!==host||config.emulators.firestore.port!==port)throw Error('Loopback config mismatch');
const info=JSON.parse(readFileSync(path.join(root,'node_modules/firebase-tools/lib/emulator/downloadableEmulatorInfo.json'))).firestore;
const cache=path.join(root,'.cache');mkdirSync(cache,{recursive:true});
const jar=path.join(cache,info.downloadPathRelativeToCacheDir);
if(!existsSync(jar))throw Error('Run npm run prepare:emulator first (artifact download only)');
if(createHash('sha256').update(readFileSync(jar)).digest('hex')!==info.expectedChecksumSHA256)throw Error('Emulator checksum mismatch');
for(const localPort of [port,9099])await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error('Emulator port already occupied: no existing service will be reused')));server.listen(localPort,host,()=>server.close(resolve));});
const log=openSync(path.join(cache,'firestore.log'),'w');
const env={...process.env,GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIRESTORE_EMULATOR_HOST:`${host}:${port}`,FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'};
const emulator=spawn('java',['-Xms64m','-Xmx768m','-Duser.language=en','-jar',jar,'--host',host,'--port',String(port),
 '--project_id',project,'--single_project_mode','true','--rules',path.join(root,'firestore.rules')],{cwd:root,env,stdio:['ignore',log,log]});
const authLog=openSync(path.join(cache,'auth.log'),'w');
const auth=spawn(process.execPath,['--require',path.join(root,'scripts/loopback-only.cjs'),path.join(root,'scripts/start-auth.mjs')],{cwd:root,env,stdio:['ignore',authLog,authLog]});
let spawnError=null;auth.once('error',e=>spawnError=e);emulator.once('error',e=>spawnError=e);
try{
 const start=Date.now();let ready=false;
 while(Date.now()-start<45000){
  if(spawnError||emulator.exitCode!==null)throw Error('Emulator startup failed; see security/.cache/firestore.log');
  ready=await new Promise(resolve=>{const s=net.createConnection({host,port});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});
  if(ready)break;await new Promise(resolve=>setTimeout(resolve,150));
 }
 if(!ready)throw Error('Emulator startup timeout');
 const authStart=Date.now();let authReady=false;while(Date.now()-authStart<15000){if(auth.exitCode!==null||spawnError)throw Error('Auth emulator startup failed');authReady=await new Promise(resolve=>{const s=net.createConnection({host,port:9099});s.once('connect',()=>{s.destroy();resolve(true);});s.once('error',()=>resolve(false));});if(authReady)break;await new Promise(r=>setTimeout(r,100));}if(!authReady)throw Error('Auth startup timeout');
 if(process.argv.includes('--lab')){
  await run(process.execPath,['--require',path.join(root,'scripts/loopback-only.cjs'),path.join(root,'scripts/seed-family.mjs'),'seed']);
  await run('python3',[path.join(root,'../scripts/build_family_lab.py')]);
  console.log('Données fictives uniquement. Fermer avec Ctrl+C. Aucun endpoint de production.');
  await run('python3',[path.join(root,'../scripts/serve_family_lab.py')]);
 }else{
 const browser=process.argv.includes('--a2-browser')||process.argv.includes('--quick-browser')||process.argv.includes('--family-browser')||process.argv.includes('--device-browser')||process.argv.includes('--integration-browser');
 const suites=browser?['browser']:process.argv.includes('--a3-device')?['tests/preprod-devices.test.mjs']:process.argv.includes('--a2-live')?['tests/preprod-live.test.mjs']:process.argv.includes('--a2')?['tests/preprod-a2.test.mjs']:process.argv.includes('--a0')?['tests/preprod-a0.test.mjs']:process.argv.includes('--all-security')?['tests/security.test.mjs','tests/family.test.mjs','tests/devices.test.mjs','tests/recovery.test.mjs']:process.argv.includes('--devices')?['tests/devices.test.mjs']:process.argv.includes('--recovery')?['tests/recovery.test.mjs']:process.argv.includes('--family')?['tests/family.test.mjs']:['tests/security.test.mjs'];
 let result;const results=[];
 for(const suite of suites){result=await new Promise((resolve,reject)=>{
  const executable=browser?'python3':process.execPath;
  const args=browser?[path.join(root,process.argv.includes('--a2-browser')?'../tests/preprod-a2-emulator-browser.py':process.argv.includes('--quick-browser')?'../tests/quick-stock-emulator-browser.py':process.argv.includes('--integration-browser')?'../tests/phase6-integration-browser.py':process.argv.includes('--device-browser')?'../tests/devices-browser.py':'../tests/family-browser.py')]:['--require',path.join(root,'scripts/loopback-only.cjs'),'--test','--test-isolation=none',path.join(root,suite)];
  const child=spawn(executable,args,{cwd:root,env,stdio:'inherit'});
  child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));
 });
 results.push({suite,...result});if(result.code!==0)process.exitCode=1;
 }
 writeFileSync(path.join(cache,'execution.json'),JSON.stringify({project,host,port,emulatorVersion:info.version,exitCode:results.some(r=>r.code!==0)?1:0,suites:results,authEmulator:{host:'127.0.0.1',port:9099,version:'firebase-tools 15.35.0'},realAccountsCreated:false,productionAccess:false},null,2));
 }
}finally{
 auth.kill('SIGTERM');
 emulator.kill('SIGTERM');
 await new Promise(resolve=>{if(emulator.exitCode!==null)return resolve();const timer=setTimeout(()=>{emulator.kill('SIGKILL');resolve();},4000);emulator.once('exit',()=>{clearTimeout(timer);resolve();});});
 await new Promise(resolve=>{if(auth.exitCode!==null||auth.signalCode!==null)return resolve();const t=setTimeout(()=>{auth.kill('SIGKILL');resolve();},2000);auth.once('exit',()=>{clearTimeout(t);resolve();});});
 closeSync(authLog);closeSync(log);
}

async function run(executable,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(executable,args,{cwd:root,env,stdio:'inherit'});
  const stop=()=>child.kill('SIGTERM');process.once('SIGINT',stop);process.once('SIGTERM',stop);
  child.once('error',reject);child.once('exit',(code,signal)=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);if(code===0||signal==='SIGTERM')resolve();else reject(Error('Local child failed: '+code));});
 });
}
