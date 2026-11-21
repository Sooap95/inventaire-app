// Built into the historical scanner section of the preproduction HTML only.
// Same html5-qrcode API; results stay local until an explicit product form save.
let html5Qr=null,scanRunning=false,pendingBarcode=null;
let barcodeStart=null,barcodeStop=Promise.resolve(),barcodeSequence=0,barcodeAccepted=false;
let barcodeProbe=null;
let barcodeDecoderReady=null,barcodeFrameStop=()=>{};
const barcodeCameraKey='inventaire-preprod-barcode-camera-v1';
const barcodeWords=()=>currentLang==='de'?{
 aim:'Den gesamten Barcode im Vorschaubild sichtbar halten.',start:'Neuer Scan',stop:'Stoppen',check:'Code prüfen',manual:'Produkt manuell eingeben',code:'Barcode',unknown:'Unbekanntes Produkt. Manuelle Eingabe möglich.',found:'Im Inventar: ',invalid:'Gültige EAN-13, UPC-A (12 Stellen) oder EAN-8 eingeben.',error:'Kamera nicht verfügbar. Kamerazugriff in Safari erlauben oder den Code manuell eingeben.',stopped:'Kamera gestoppt. Neuer Scan oder manuelle Eingabe möglich.',camera:'Kamera',automatic:'Automatische Auswahl (hinten)',cameraTip:'Bild unscharf? Abstand anpassen oder eine andere Kamera wählen. Die Auswahl wird in diesem Browser gespeichert.',fallback:'Gespeicherte Kamera nicht verfügbar. Andere Rückkamera verwendet; Auswahl bei Bedarf ändern.',compatible:'Kompatibilitätsmodus: eingeschränkte Erkennung. Bei Bedarf den Code manuell eingeben.'
}:{aim:'Garde le code-barres entier visible dans l’aperçu.',start:'Nouveau scan',stop:'Arrêter',check:'Vérifier le code',manual:'Saisir le produit manuellement',code:'Code-barres',unknown:'Produit inconnu. Saisie manuelle disponible.',found:'Dans l’inventaire : ',invalid:'Saisir un EAN-13, un UPC-A (12 chiffres) ou un EAN-8 valide.',error:'Caméra indisponible. Autoriser la caméra dans Safari ou saisir le code manuellement.',stopped:'Caméra arrêtée. Nouveau scan ou saisie manuelle disponible.',camera:'Caméra',automatic:'Choix automatique (arrière)',cameraTip:'Image floue ? Ajuste la distance ou choisis une autre caméra. Le choix reste mémorisé dans ce navigateur.',fallback:'Caméra mémorisée indisponible. Autre caméra arrière utilisée ; change le choix si nécessaire.',compatible:'Mode compatible : reconnaissance limitée. Saisis le code manuellement si nécessaire.'};
function validBarcode(code){
 if(!/^(?:\d{8}|\d{12}|\d{13})$/.test(code))return false;
 let sum=0;for(let i=code.length-2,n=0;i>=0;i--,n++)sum+=Number(code[i])*(n%2?1:3);
 return (10-sum%10)%10===Number(code.at(-1));
}
function barcodeAliases(code){return code.length===12?[code,'0'+code]:code.length===13&&code[0]==='0'?[code,code.slice(1)]:[code];}
function barcodeAllowed(){return window.FAMILY_LAB_CONFIG?.mode==='preprod'&&window.FamilyApp?.runtimeInfo?.barcodeScanner===true&&window.FamilyApp.allowProductAction();}
// Device order is not a lens contract. Use known FR/DE/EN labels only; unknown
// labels stay available in the selector, without guessing a physical lens.
function barcodeCameraScore(label){
 const name=String(label||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 if(/front|facetime|truedepth|avant|frontal|vorder|selfie/.test(name))return -1;
 if(!/back|rear|arriere|ruck|rueck|hinter/.test(name))return -1;
 if(/triple|dual|double|dreifach/.test(name))return 110;
 if(/ultra|macro|tele|virtual|composite|0[.,]5\s*[x×]/.test(name))return -1;
 return /wide|grand.?angle|weitwinkel|standard|1\s*[x×]/.test(name)?100:80;
}
function barcodeCameraChoice(devices,saved){
 if(saved&&devices.some(d=>d.deviceId===saved))return saved;
 return devices.filter(d=>barcodeCameraScore(d.label)>=0).sort((a,b)=>barcodeCameraScore(b.label)-barcodeCameraScore(a.label))[0]?.deviceId||'';
}
function barcodeCameraPreference(value){
 try{if(value===undefined)return localStorage.getItem(barcodeCameraKey)||'';if(value)localStorage.setItem(barcodeCameraKey,value);else localStorage.removeItem(barcodeCameraKey);}catch{}
 return '';
}
async function barcodeCameras(){try{return (await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput'&&d.deviceId);}catch{return [];}}
function barcodeCurrent(sequence){return sequence===barcodeSequence&&!document.hidden&&!document.getElementById('scan-modal').classList.contains('hidden')&&barcodeAllowed();}
async function barcodeCameraRequest(sequence,explicit){
 if(explicit)return {deviceId:{exact:explicit}};
 let devices=await barcodeCameras();if(!barcodeCurrent(sequence))return null;
 const saved=barcodeCameraPreference(),revealed=devices.some(d=>d.label);
 // Safari may hide every label until permission is granted. Reuse a previously
 // successful ID directly; do not reopen an automatic camera just to list it.
 const preferred=barcodeCameraChoice(devices,saved)||(!revealed?saved:'');
 if(preferred)return {deviceId:{exact:preferred}};
 if(saved&&revealed)barcodeCameraPreference('');
 if(!revealed&&navigator.mediaDevices?.getUserMedia){
  let stream;
  try{
   stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'}}});barcodeProbe=stream;
   if(!barcodeCurrent(sequence))return null;
   devices=await barcodeCameras();if(!barcodeCurrent(sequence))return null;
   const id=barcodeCameraChoice(devices,'')||stream.getVideoTracks()[0]?.getSettings?.().deviceId;
   if(id)return {deviceId:{exact:id}};
  }finally{for(const track of stream?.getTracks()||[])track.stop();if(barcodeProbe===stream)barcodeProbe=null;}
 }
 return {facingMode:'environment'};
}
async function barcodeCameraOptions(sequence){
 const devices=await barcodeCameras();if(sequence!==barcodeSequence)return;
 const label=document.getElementById('barcode-camera-label'),select=document.getElementById('barcode-camera'),w=barcodeWords();
 label.firstChild.textContent=w.camera;select.replaceChildren();
 const add=(id,name)=>{const o=document.createElement('option');o.value=id;o.textContent=name;select.append(o);};
 add('',w.automatic);for(const [i,device] of devices.entries())add(device.deviceId,device.label||w.camera+' '+(i+1));
 const active=document.querySelector('#reader video')?.srcObject?.getVideoTracks?.()[0]?.getSettings?.().deviceId||barcodeCameraPreference();
 if(devices.some(d=>d.deviceId===active))select.value=active;
 label.hidden=devices.length<2;label.style.display=label.hidden?'none':'block';document.getElementById('barcode-camera-tip').textContent=w.cameraTip;
}
function barcodeControls(){
 if(document.getElementById('barcode-result'))return;
 const body=document.querySelector('#scan-modal .modal-body'),result=document.createElement('p'),controls=document.createElement('div'),input=document.createElement('input');
 result.id='barcode-result';result.setAttribute('role','status');result.setAttribute('aria-live','polite');result.style.overflowWrap='anywhere';
 input.id='barcode-manual-code';input.inputMode='numeric';input.type='text';input.autocomplete='off';input.setAttribute('aria-label',barcodeWords().code);input.style.cssText='font-size:16px;width:100%;box-sizing:border-box;min-height:44px';
 controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:12px';
 const add=(id,text,fn)=>{const b=document.createElement('button');b.id=id;b.type='button';b.className='btn btn-outline';b.style.minHeight='44px';b.textContent=text;b.onclick=fn;controls.append(b);return b;};
 add('barcode-restart',barcodeWords().start,()=>startBarcode());
 add('barcode-stop',barcodeWords().stop,()=>{barcodeSequence++;void stopScanIfRunning();document.getElementById('scan-hint').textContent=barcodeWords().stopped;});
 add('barcode-check',barcodeWords().check,()=>handleScanResult(input.value.trim(),true));
 const manual=add('barcode-product-manual',barcodeWords().manual,()=>{if(!barcodeAllowed())return;const code=input.value.trim();if(!validBarcode(code))return;pendingBarcode=code;closeScanner();createFromScan();});manual.hidden=true;manual.style.display='none';
 const cameraLabel=document.createElement('label'),camera=document.createElement('select'),tip=document.createElement('small');
 cameraLabel.id='barcode-camera-label';cameraLabel.append(document.createTextNode(barcodeWords().camera));cameraLabel.hidden=true;cameraLabel.style.display='none';
 camera.id='barcode-camera';camera.style.cssText='display:block;font-size:16px;min-height:44px;width:100%;max-width:100%;margin-top:4px';camera.onchange=()=>{const id=camera.value;barcodeCameraPreference('');void startBarcode(id);};
 tip.id='barcode-camera-tip';tip.style.cssText='display:block;margin:6px 0;overflow-wrap:anywhere';cameraLabel.append(camera,tip);
 body.append(result,input,cameraLabel,controls);
}
function barcodeReleaseTracks(){for(const track of barcodeProbe?.getTracks()||[])track.stop();for(const video of document.querySelectorAll('#reader video'))for(const track of video.srcObject?.getTracks?.()||[])track.stop();}
function barcodeFrameSize(width,height){const scale=Math.min(1,1280/Math.max(width,height));return {width:Math.max(1,Math.round(width*scale)),height:Math.max(1,Math.round(height*scale))};}
function barcodeDecoder(){
 if(!barcodeDecoderReady)barcodeDecoderReady=(async()=>{
  const engine=window.ZXingWASM;if(!engine||!window.WebAssembly)throw Error('BARCODE_ENGINE_UNAVAILABLE');
  const url=new URL('/src/preprod/barcode-assets/zxing_reader.wasm',location.origin),response=await fetch(url,{credentials:'omit',redirect:'error'});
  if(!response.ok||new URL(response.url).origin!==location.origin)throw Error('BARCODE_ENGINE_RESPONSE');
  const bytes=await response.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==engine.ZXING_WASM_SHA256)throw Error('BARCODE_ENGINE_INTEGRITY');
  await engine.prepareZXingModule({overrides:{wasmBinary:bytes,locateFile:path=>{if(path!=='zxing_reader.wasm')throw Error('BARCODE_EXTERNAL_ASSET_FORBIDDEN');return url.href;},print:()=>{},printErr:()=>{}},fireImmediately:true});
  return engine;
 })().catch(error=>{barcodeDecoderReady=null;throw error;});
 return barcodeDecoderReady;
}
async function barcodeReadFrames(reader,sequence){
 let stopped=false,timer=null,legacyScan=null;
 const cancel=()=>{stopped=true;clearTimeout(timer);};barcodeFrameStop=cancel;
 const active=()=>!stopped&&!barcodeAccepted&&html5Qr===reader&&barcodeCurrent(sequence);
 const compatible=()=>{if(legacyScan)reader.scanContext=legacyScan;if(active())document.getElementById('scan-hint').textContent=barcodeWords().compatible;cancel();};
 try{
  if(!active())return;
  const engine=await barcodeDecoder();if(!active())return;
  // Pinned html5-qrcode 2.3.8 adapter: retain its camera lifecycle and visual
  // guide, skip only its low-resolution decode hook. Public pause(false) also
  // displays a paused-camera overlay and can race with its UI initialization.
  if(typeof reader.scanContext==='function'){legacyScan=reader.scanContext;reader.scanContext=()=>Promise.resolve(false);}
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d',{willReadFrequently:true});
  const tick=async()=>{
   if(!active())return;
   try{
    const video=document.querySelector('#reader video');
    if(video?.readyState>=2&&video.videoWidth&&video.videoHeight){
     const size=barcodeFrameSize(video.videoWidth,video.videoHeight);if(canvas.width!==size.width||canvas.height!==size.height){canvas.width=size.width;canvas.height=size.height;}
     // Native video pixels, independent of CSS size and of the visual guide.
     context.drawImage(video,0,0,canvas.width,canvas.height);
     const results=await engine.readBarcodes(context.getImageData(0,0,canvas.width,canvas.height),{formats:['EAN-13','UPC-A','EAN-8'],tryHarder:true,maxNumberOfSymbols:1});
     if(active()){const result=results.find(r=>validBarcode(String(r.text)));if(result){handleScanResult(result.text);return;}}
    }
    if(active())timer=setTimeout(tick,120);
   }catch{compatible();}
  };void tick();
 }catch{compatible();}
}
function stopScanIfRunning(){
 // Do not stop a stream before html5-qrcode has finished reading its video
 // dimensions: an early stop can leave its start() promise unresolved.
 barcodeAccepted=true;barcodeFrameStop();for(const track of barcodeProbe?.getTracks()||[])track.stop();if(scanRunning)barcodeReleaseTracks();
 const reader=html5Qr,ready=barcodeStart,previous=barcodeStop;
 barcodeStop=(async()=>{
  await previous.catch(()=>{});if(ready)await ready.catch(()=>{});
  if(reader){try{if(reader.isScanning||scanRunning)await reader.stop();}catch{}try{reader.clear();}catch{}}
  barcodeReleaseTracks();if(html5Qr===reader){html5Qr=null;barcodeStart=null;scanRunning=false;}
 })();return barcodeStop;
}
function openScanner(){
 if(!barcodeAllowed())return;
 barcodeControls();document.getElementById('scan-modal').classList.remove('hidden');return startBarcode();
}
async function startBarcode(explicit){
 if(!barcodeAllowed())return;
 const sequence=++barcodeSequence;await stopScanIfRunning();
 if(sequence!==barcodeSequence||document.getElementById('scan-modal').classList.contains('hidden'))return;
 const w=barcodeWords(),input=document.getElementById('barcode-manual-code');document.getElementById('barcode-result').textContent='';input.value='';input.placeholder=w.code;input.setAttribute('aria-label',w.code);document.getElementById('scan-hint').textContent=w.aim;
 const manual=document.getElementById('barcode-product-manual');manual.hidden=true;manual.style.display='none';
 for(const [id,key] of [['barcode-restart','start'],['barcode-stop','stop'],['barcode-check','check'],['barcode-product-manual','manual']])document.getElementById(id).textContent=w[key];
 if(!window.isSecureContext){document.getElementById('scan-hint').textContent=t('scan_needs_https');return;}
 if(typeof Html5Qrcode==='undefined'){document.getElementById('scan-hint').textContent=w.error;return;}
 barcodeAccepted=false;
 try{
  const formats=Html5QrcodeSupportedFormats,reader=new Html5Qrcode('reader',{formatsToSupport:[formats.EAN_13,formats.UPC_A,formats.EAN_8],verbose:false});html5Qr=reader;
  const config={fps:10,disableFlip:true,qrbox:(width,height)=>({width:Math.max(50,Math.floor(Math.min(300,width*.9))),height:Math.max(50,Math.floor(Math.min(160,height*.7)))})},success=code=>{if(barcodeCurrent(sequence))handleScanResult(code);};
  // videoConstraints overrides html5-qrcode's camera argument: preserve the
  // selected device/facingMode explicitly, and request HD as a preference only.
  const startCamera=camera=>reader.start(camera,{...config,videoConstraints:{...camera,width:{ideal:1280},height:{ideal:720}}},success,()=>{});
  barcodeStart=Promise.resolve().then(async()=>{
   const camera=await barcodeCameraRequest(sequence,explicit);if(!camera||!barcodeCurrent(sequence))return;
   try{await startCamera(camera);if(camera.deviceId&&barcodeCurrent(sequence))barcodeCameraPreference(camera.deviceId.exact);}
   catch(error){
    if(!camera.deviceId||!/NotFoundError|OverconstrainedError/.test(String(error))||!barcodeCurrent(sequence))throw error;
    barcodeCameraPreference('');try{reader.clear();}catch{}
    document.getElementById('scan-hint').textContent=barcodeWords().fallback;
    await startCamera({facingMode:'environment'});
   }
  });
  await barcodeStart;scanRunning=true;
  for(const video of document.querySelectorAll('#reader video')){video.setAttribute('playsinline','');video.muted=true;}
  // A newer start/close already scheduled this instance's cleanup. Do not enqueue
  // an old clear() behind the next camera start.
  if(sequence!==barcodeSequence||document.getElementById('scan-modal').classList.contains('hidden'))return;
  void barcodeCameraOptions(sequence);
  void barcodeReadFrames(reader,sequence);
 }catch{
  if(sequence===barcodeSequence){document.getElementById('scan-hint').textContent=w.error;await stopScanIfRunning();}
 }
}
function closeScanner(){barcodeSequence++;document.getElementById('scan-modal').classList.add('hidden');void stopScanIfRunning();}
function handleScanResult(value,manual=false){
 if(!barcodeAllowed()||(!manual&&barcodeAccepted))return;
 const code=String(value).trim();if(!validBarcode(code)){if(manual)document.getElementById('scan-hint').textContent=barcodeWords().invalid;return;}
 barcodeAccepted=true;document.getElementById('barcode-manual-code').value=code;
 const aliases=barcodeAliases(code),matches=products.filter(p=>aliases.includes(String(p.barcode||'').trim()));
 document.getElementById('barcode-result').textContent=barcodeWords().code+' : '+code+' — '+(matches.length?barcodeWords().found+matches.map(p=>p.name).join(', '):barcodeWords().unknown);
 const button=document.getElementById('barcode-product-manual');button.hidden=matches.length>0;button.style.display=matches.length?'none':'';
 document.getElementById('scan-hint').textContent=barcodeWords().stopped;void stopScanIfRunning();
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){barcodeSequence++;void stopScanIfRunning();}});
window.addEventListener('pagehide',()=>{barcodeSequence++;void stopScanIfRunning();});
