import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {webcrypto} from 'node:crypto';
const source=readFileSync(new URL('../src/preprod/barcode-scanner.js',import.meta.url),'utf8');
const context=vm.createContext({document:{addEventListener(){}},window:{addEventListener(){}},currentLang:'fr'});vm.runInContext(source,context);const words=()=>vm.runInContext('barcodeWords()',context);
test('Scanner : EAN-13 UPC-A EAN-8 et chiffres de contrôle réels',()=>{for(const code of ['4006381333931','036000291452','96385074'])assert.equal(context.validBarcode(code),true);for(const code of ['4006381333932','036000291451','96385075','123','https://example.test/','<img>'])assert.equal(context.validBarcode(code),false);});
test('Scanner : rapprochement UPC-A / EAN-13 sans changer la valeur stockée',()=>{assert.deepEqual([...context.barcodeAliases('036000291452')],['036000291452','0036000291452']);assert.deepEqual([...context.barcodeAliases('0036000291452')],['0036000291452','036000291452']);assert.deepEqual([...context.barcodeAliases('96385074')],['96385074']);});
test('Scanner : libellés FR et DE, aucun changement du refus média général',()=>{assert.match(words().manual,/manuellement/);context.currentLang='de';assert.match(words().manual,/manuell/);assert.equal(context.barcodeAllowed(),false);context.window.FAMILY_LAB_CONFIG={mode:'preprod'};context.window.FamilyApp={runtimeInfo:{barcodeScanner:true},allowProductAction:()=>false};assert.equal(context.barcodeAllowed(),false);context.window.FamilyApp.allowProductAction=()=>true;assert.equal(context.barcodeAllowed(),true);});
const cameras=labels=>labels.map((label,i)=>({kind:'videoinput',deviceId:String(i),label}));
test('Scanner : sans caméra triple, privilégie la caméra arrière standard parmi macro, ultra-large et téléobjectif, sans supposer leur ordre',()=>{
 for(const labels of [['Back Ultra Wide Camera','Back Telephoto Camera','Back Wide Angle Camera','Front Camera'],['Caméra arrière ultra grand-angle','Caméra avant','Caméra arrière grand-angle','Caméra arrière téléobjectif'],['Rückkamera Ultraweitwinkel','Vorderkamera','Rückkamera mit Weitwinkel','Rückkamera Teleobjektiv']]){
  const devices=cameras(labels);assert.equal(context.barcodeCameraChoice(devices,''),'2');assert.equal(context.barcodeCameraChoice([...devices].reverse(),''),'2');
 }
});
test('Scanner : noms arrière simples FR/DE/EN acceptés, caméra inconnue jamais identifiée par sa position',()=>{
 for(const label of ['Back Camera','Caméra arrière','Rückkamera'])assert.equal(context.barcodeCameraChoice(cameras(['Front Camera',label]),''),'1');
 assert.equal(context.barcodeCameraChoice(cameras(['Camera 1','Camera 2']),''),'');
 assert.equal(context.barcodeCameraChoice(cameras(['Back Macro Camera','Back Telephoto Camera','Front TrueDepth Camera']),''),'');
});
test('Scanner : recette réelle, caméra triple arrière préférée sans imposer un objectif physique ; choix manuel toujours prioritaire',()=>{
 for(const label of ['Back Triple Camera','Triple caméra arrière','Dreifach-Rückkamera']){const devices=cameras(['Back Camera',label]);assert.equal(context.barcodeCameraChoice(devices,''),'1');assert.equal(context.barcodeCameraChoice(devices,'0'),'0');}
});
test('Scanner : résolution de lecture bornée mais indépendante des pixels CSS de l’aperçu',()=>{
 assert.deepEqual({...context.barcodeFrameSize(1920,1080)},{width:1280,height:720});assert.deepEqual({...context.barcodeFrameSize(1080,1920)},{width:720,height:1280});assert.deepEqual({...context.barcodeFrameSize(640,480)},{width:640,height:480});
});
test('Scanner : respecte le choix mémorisé, remplace un identifiant disparu et tolère le stockage indisponible',()=>{
 const devices=cameras(['Back Camera','Back Ultra Wide Camera']);assert.equal(context.barcodeCameraChoice(devices,'1'),'1');assert.equal(context.barcodeCameraChoice(devices,'disappeared'),'0');
 const saved=new Map();context.localStorage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 context.barcodeCameraPreference('chosen');assert.equal(context.barcodeCameraPreference(),'chosen');context.barcodeCameraPreference('');assert.equal(context.barcodeCameraPreference(),'');
 context.localStorage={getItem(){throw Error('denied');},setItem(){throw Error('denied');}};assert.equal(context.barcodeCameraPreference(),'');assert.doesNotThrow(()=>context.barcodeCameraPreference('chosen'));
});
function cameraSession(media){
 const saved=new Map(),c=vm.createContext({navigator:{mediaDevices:media},document:{hidden:false,addEventListener(){},getElementById:()=>({classList:{contains:()=>false}})},window:{addEventListener(){},FAMILY_LAB_CONFIG:{mode:'preprod'},FamilyApp:{runtimeInfo:{barcodeScanner:true},allowProductAction:()=>true}},currentLang:'fr',localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)}});vm.runInContext(source,c);return c;
}
test('Scanner : premier accès sans libellés, permission sans audio puis lentille standard ; flux provisoire libéré',async()=>{
 let permission=false,probes=0,stops=0;
 const c=cameraSession({enumerateDevices:async()=>permission?cameras(['Front Camera','Back Ultra Wide Camera','Back Camera']):[],getUserMedia:async constraints=>{assert.equal(constraints.audio,false);permission=true;probes++;return {getTracks:()=>[{stop(){stops++;}}],getVideoTracks:()=>[{getSettings:()=>({deviceId:'1'})}]};}});
 assert.equal((await c.barcodeCameraRequest(0)).deviceId.exact,'2');assert.equal(probes,1);assert.equal(stops,1);
});
test('Scanner : identifiant mémorisé réutilisé même si Safari masque les libellés, sans deuxième ouverture pour permission',async()=>{
 let probes=0;const c=cameraSession({enumerateDevices:async()=>[],getUserMedia:async()=>{probes++;throw Error('must not open');}});c.barcodeCameraPreference('saved-standard');assert.equal((await c.barcodeCameraRequest(0)).deviceId.exact,'saved-standard');assert.equal(probes,0);
});
test('Scanner : fermeture pendant la première permission, flux libéré et aucun démarrage tardif',async()=>{
 let resolvePermission,requested,stops=0;const waiting=new Promise(resolve=>{requested=resolve;});
 const c=cameraSession({enumerateDevices:async()=>[],getUserMedia:()=>{requested();return new Promise(resolve=>{resolvePermission=resolve;});}});
 const result=c.barcodeCameraRequest(0);await waiting;vm.runInContext('barcodeSequence++',c);resolvePermission({getTracks:()=>[{stop(){stops++;}}]});assert.equal(await result,null);assert.equal(stops,1);
});
test('Scanner : moteur absent ou WASM altéré refusé, aucun chargement externe ni compilation des octets incorrects',async()=>{
 const c=cameraSession({});await assert.rejects(c.barcodeDecoder(),/BARCODE_ENGINE_UNAVAILABLE/);
 let prepared=0,requests=0;c.URL=URL;c.crypto=webcrypto;c.location={origin:'https://inventaire-maison-v02-recette-sync.pages.dev'};c.window.WebAssembly={};c.window.ZXingWASM={ZXING_WASM_SHA256:'invalid',prepareZXingModule(){prepared++;}};
 c.fetch=async(url,options)=>{requests++;assert.equal(url.origin,c.location.origin);assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');return {ok:true,url:url.href,arrayBuffer:async()=>new Uint8Array([0,1,2]).buffer};};
 await assert.rejects(c.barcodeDecoder(),/BARCODE_ENGINE_INTEGRITY/);assert.equal(requests,1);assert.equal(prepared,0);
});
