import test from 'node:test';import assert from 'node:assert/strict';
import {LIVE_BINDING,assertLiveContext,assertLiveDatabase,validateLiveBinding} from '../src/preprod/live-target.js';
import {livePreprodPolicy,preprodPolicy,checkTarget} from '../security/src/target-policy.mjs';
import {initializeApp,deleteApp} from '../security/node_modules/firebase/app/dist/index.mjs';
import {getFirestore} from '../security/node_modules/firebase/firestore/dist/index.mjs';
const binding=()=>structuredClone(LIVE_BINDING);
const db=p=>({app:{options:{projectId:p.projectId,...p.firebase}},_databaseId:{database:'(default)'},_settings:{host:'firestore.googleapis.com',ssl:true}});
function at(origin,fn){const old=globalThis.location;globalThis.location={origin,protocol:origin.startsWith('https:')?'https:':'http:'};try{return fn();}finally{if(old===undefined)delete globalThis.location;else globalThis.location=old;}}
test('Live : liaison vérifiée exacte, aucune modification silencieuse du binding',()=>{const p=binding();assert.deepEqual(validateLiveBinding(p),p);for(const change of [{projectId:'other'},{projectNumber:'1'},{databaseId:'other'},{location:'eur3'},{origin:LIVE_BINDING.origin+'/other'}])assert.throws(()=>validateLiveBinding({...p,...change}));for(const key of ['apiKey','appId','authDomain'])assert.throws(()=>validateLiveBinding({...p,firebase:{...p.firebase,[key]:'changed'}}));});
test('Live : origine HTTPS exacte seule autorisée',()=>{at(LIVE_BINDING.origin,()=>assertLiveContext(binding()));for(const origin of ['http://127.0.0.1','https://preview.inventaire-maison-v02-recette-sync.pages.dev','https://example.test'])at(origin,()=>assert.throws(()=>assertLiveContext(binding()),/LIVE_ORIGIN/));});
test('Live : handle Firestore strict, garde renouvelée après changement de cible',()=>at(LIVE_BINDING.origin,()=>{const p=binding(),d=db(p),policy=livePreprodPolicy(p);checkTarget(policy,d);d._settings.host='127.0.0.1:8180';assert.throws(()=>checkTarget(policy,d),/LIVE_DATABASE/);d._settings.host='firestore.googleapis.com';checkTarget(policy,d);at('https://example.test',()=>assert.throws(()=>checkTarget(policy,d),/LIVE_ORIGIN/));}));
test('Live : projet, app, clé, TLS et base modifiés refusés avant toute transaction',()=>at(LIVE_BINDING.origin,()=>{for(const mutate of [d=>d.app.options.projectId='other',d=>d.app.options.apiKey='wrong',d=>d.app.options.appId='wrong',d=>d._settings.ssl=false,d=>d._databaseId.database='other']){const d=db(binding());mutate(d);assert.throws(()=>assertLiveDatabase(d,binding()),/LIVE_DATABASE/);}}));
test('Live : politique liée à une copie, token opaque obligatoire',()=>at(LIVE_BINDING.origin,()=>{const p=binding(),policy=livePreprodPolicy(p);p.firebase.apiKey='changed';checkTarget(policy,db(binding()));for(const fake of [null,{},()=>{}, {kind:'preprod-live'}, {...policy}])assert.throws(()=>checkTarget(fake,db(binding())),/EXPLICIT_TARGET_POLICY_REQUIRED/);}));
test('Live : A2-L reste fermé sur la même origine même après activation séparée',()=>at(LIVE_BINDING.origin,()=>{const p=binding();assert.throws(()=>checkTarget(preprodPolicy(p),db(p)),/A2_L_CLOUD_DISABLED/);}));
test('Live : compatibilité avec le handle du SDK verrouillé, sans requête ni identité',async()=>{
 const old=globalThis.location,fetch=globalThis.fetch;let requests=0;
 globalThis.location={origin:LIVE_BINDING.origin,protocol:'https:'};globalThis.fetch=()=>{requests++;throw Error('NETWORK_FORBIDDEN_IN_LOCAL_TEST');};
 let app;
 try{const p=binding();app=initializeApp({projectId:p.projectId,...p.firebase},'local-handle-verification');const firestore=getFirestore(app,p.databaseId);assertLiveDatabase(firestore,p);checkTarget(livePreprodPolicy(p),firestore);assert.equal(requests,0);}
 finally{if(app)await deleteApp(app);globalThis.fetch=fetch;if(old===undefined)delete globalThis.location;else globalThis.location=old;}
});
