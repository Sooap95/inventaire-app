"""Pinned historical decoder, synthetic barcodes and fake video; no phone/Firebase."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import sys,tempfile,subprocess,ssl,threading,json,base64,time
from PIL import Image,ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from build_preprod_live import CSP
D=ROOT/'dist/preprod-live';OUT=ROOT/'test-results/preprod-scanner';OUT.mkdir(parents=True,exist_ok=True)
ORIGIN='https://inventaire-maison-v02-recette-sync.pages.dev'
L=['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];R=[''.join('1' if b=='0' else '0' for b in x) for x in L];G=[x[::-1] for x in R]
PARITY=['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL']
def barcode(code):
 if len(code)==12:code='0'+code
 if len(code)==13:bits='101'+''.join((L if p=='L' else G)[int(n)] for p,n in zip(PARITY[int(code[0])],code[1:7]))+'01010'+''.join(R[int(n)] for n in code[7:])+'101'
 else:bits='101'+''.join(L[int(n)] for n in code[:4])+'01010'+''.join(R[int(n)] for n in code[4:])+'101'
 image=Image.new('RGB',(640,280),'white');draw=ImageDraw.Draw(image);scale=5;left=(640-len(bits)*scale)//2
 for i,b in enumerate(bits):
  if b=='1':draw.rectangle((left+i*scale,40,left+(i+1)*scale-1,235),fill='black')
 return image
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(D),**kwargs)
 def translate_path(self,path):
  value=super().translate_path(path);return value+'.html' if not Path(value).exists() and Path(value+'.html').is_file() else value
 def log_message(self,*args):pass
 def end_headers(self):
  self.send_header('Content-Security-Policy',CSP);self.send_header('Permissions-Policy','camera=(self), microphone=(), geolocation=()');super().end_headers()

with tempfile.TemporaryDirectory() as tmp:
 tmp=Path(tmp);images={}
 for code in ['4006381333931','036000291452','96385074']:
  p=tmp/(code+'.png');barcode(code).save(p);images[code]=base64.b64encode(p.read_bytes()).decode()
 frame=Image.new('RGB',(1280,720),'white');frame.paste(barcode('4006381333931').resize((1280,560),Image.Resampling.NEAREST),(0,80));y=frame.convert('L').point(lambda x:16+x*219//255).tobytes();uv=bytes([128])*(1280*720//2)
 video=tmp/'barcode.y4m'
 with video.open('wb') as f:
  f.write(b'YUV4MPEG2 W1280 H720 F10:1 Ip A1:1 C420jpeg\n')
  for _ in range(8):f.write(b'FRAME\n'+y+uv)
 cert,key=tmp/'cert.pem',tmp/'key.pem';subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=inventaire-maison-v02-recette-sync.pages.dev'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 server=ThreadingHTTPServer(('127.0.0.1',443),Handler);tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key);server.socket=tls.wrap_socket(server.socket,server_side=True);threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--no-proxy-server','--ignore-certificate-errors','--host-resolver-rules=MAP inventaire-maison-v02-recette-sync.pages.dev 127.0.0.1','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--use-file-for-fake-video-capture='+str(video)])
   ctx=browser.new_context(ignore_https_errors=True,permissions=['camera'],viewport={'width':393,'height':852},has_touch=True)
   outside=[];errors=[];checks=[]
   def ok(name):checks.append(name);print('PASS '+name,flush=True)
   ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith((ORIGIN+'/', 'blob:','data:')) else (outside.append(r.request.url.split('?')[0]),r.abort()))
   ctx.add_init_script("""window.__streams=[];window.__cameraRequests=[];window.__cameraCalls=0;const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{window.__cameraCalls++;window.__cameraRequests.push(c);const s=await gum(c);window.__streams.push(s);return s;};""")
   page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(ORIGIN+'/');page.wait_for_selector('#preprod-start-profile')
   page.evaluate('()=>openScanner()');assert page.evaluate('window.__cameraCalls')==0;ok('Profil non autorisé : aucune demande caméra')
   page.evaluate("""()=>{window.__writes=0;window.FamilyApp={runtimeInfo:{barcodeScanner:true},allowProductAction:()=>true,externalLookup:()=>false,refresh(){},renderQuickStock(){},saveProduct:async()=>{window.__writes++},linkBarcode:async()=>{window.__writes++}};window.familyHost.replace([{id:'fictional-milk',name:'Lait fictif',unit:'L',stock:1,threshold:1,target:3,frequency:'',barcode:'4006381333931',restockHistory:[]}]);}""")
   # Fictional multi-lens labels, with the standard lens mapped to the real
   # Chromium fake-video device. No iPhone hardware is inferred by this test.
   page.evaluate("""async()=>{window.__standardId=(await navigator.mediaDevices.enumerateDevices()).find(d=>d.kind==='videoinput').deviceId;navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'fictional-ultra',label:'Back Ultra Wide Camera'},{kind:'videoinput',deviceId:window.__standardId,label:'Back Camera'},{kind:'videoinput',deviceId:'fictional-front',label:'Front Camera'}];}""")
   decoded={}
   for code,data in images.items():
    result=page.evaluate("""async data=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const q=new Html5Qrcode('reader',{formatsToSupport:[Html5QrcodeSupportedFormats.EAN_13,Html5QrcodeSupportedFormats.UPC_A,Html5QrcodeSupportedFormats.EAN_8],verbose:false});try{return (await q.scanFileV2(new File([bytes],'barcode.png',{type:'image/png'}),false)).decodedText;}finally{q.clear();}}""",data)
    assert result==code,(code,result);decoded[code]=result
   ok('Décodeur html5-qrcode réel : EAN-13, UPC-A et EAN-8 reconnus sur images synthétiques')
   for code,data in images.items():
    result=page.evaluate("""async data=>{const engine=await barcodeDecoder(),image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);return (await engine.readBarcodes(c.getContext('2d').getImageData(0,0,c.width,c.height),{formats:['EAN-13','UPC-A','EAN-8'],tryHarder:true}))[0]?.text;}""",data)
    # UPC-A and zero-prefixed EAN-13 have identical bars; ZXing-C++ returns
    # the EAN-13 representation when both formats are enabled. Inventory
    # matching already handles both aliases, without changing stored values.
    assert result==code or len(code)==12 and result=='0'+code,(code,result)
   ok('Nouveau décodeur WASM local et vérifié : EAN-13, UPC-A équivalent EAN-13, EAN-8 reconnus, aucune requête CDN')
   page.evaluate("""()=>{window.__wasmReads=0;const read=ZXingWASM.readBarcodes;ZXingWASM.readBarcodes=(...args)=>{window.__wasmReads++;return read(...args);};const start=Html5Qrcode.prototype.start;Html5Qrcode.prototype.start=function(cam,config,success,error){return start.call(this,cam,config,()=>{},e=>{window.__lastDecodeError=String(e);error(e);});};}""")
   durations=[]
   for i in range(3):
    started=time.monotonic()
    if i==0:page.evaluate('()=>openScanner()')
    else:page.locator('#barcode-restart').click()
    try:page.wait_for_function("()=>document.getElementById('barcode-result').textContent.includes('4006381333931')",timeout=15000)
    except Exception:
     print(page.evaluate("""()=>({hint:document.getElementById('scan-hint').textContent,running:scanRunning,accepted:barcodeAccepted,hidden:document.hidden,cameraCalls:window.__cameraCalls,lastDecodeError:window.__lastDecodeError,video:[...document.querySelectorAll('#reader video')].map(v=>({width:v.videoWidth,height:v.videoHeight,ready:v.readyState,paused:v.paused})),tracks:window.__streams.map(s=>s.getTracks().map(t=>t.readyState))})"""),flush=True)
     print('JS errors:',errors,flush=True);page.screenshot(path=str(OUT/'camera-failure.png'),full_page=True);raise
    durations.append(round(time.monotonic()-started,3))
    page.wait_for_function('()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState===\'ended\'))')
    assert 'Lait fictif' in page.locator('#barcode-result').inner_text()
   assert page.evaluate('window.__cameraCalls')==3;assert page.evaluate('window.__writes')==0;ok('Trois scans caméra successifs sans recharge, résultat immédiat et pistes libérées')
   assert page.evaluate('window.__wasmReads')>=3;ok('Trois scans effectivement décodés par WASM sur pixels natifs, ancien callback neutralisé')
   assert page.evaluate('()=>window.__cameraRequests.every(c=>c.video.deviceId?.exact===window.__standardId)');ok('Caméra arrière standard sélectionnée par deviceId, sans démarrage ultra-large ni requête caméra supplémentaire')
   for width in [320,375,393,428,768,1440]:
    page.set_viewport_size({'width':width,'height':852});assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth'),width
   page.set_viewport_size({'width':393,'height':852});page.screenshot(path=str(OUT/'scanner-fr-393.png'),full_page=True)
   ok('Modal scanner sans débordement aux six largeurs 320 à 1440 px')
   page.evaluate("()=>{handleScanResult('96385074');handleScanResult('036000291452');}")
   assert '4006381333931' in page.locator('#barcode-result').inner_text();ok('Lectures répétées après détection ignorées')
   # Keep the real fake camera running by suppressing only its result callback.
   page.evaluate("""()=>{window.__savedWasmRead=ZXingWASM.readBarcodes;ZXingWASM.readBarcodes=async()=>[];window.__savedStart=Html5Qrcode.prototype.start;Html5Qrcode.prototype.start=function(...args){args[2]=()=>{};return window.__savedStart.apply(this,args);};}""")
   page.locator('#barcode-restart').click();page.wait_for_function("()=>window.__streams.length===4&&window.__streams.at(-1).getVideoTracks().some(t=>t.readyState==='live')")
   assert page.evaluate('()=>window.__streams.every(s=>s.getAudioTracks().length===0)')
   page.locator('#barcode-stop').click();page.wait_for_function("()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")
   page.evaluate('()=>{Html5Qrcode.prototype.start=window.__savedStart;ZXingWASM.readBarcodes=window.__savedWasmRead;}');ok('Arrêter avec le décodeur réel : pistes vidéo libérées, aucun microphone ouvert')
   page.evaluate("""()=>{window.__savedRead=ZXingWASM.readBarcodes;window.__resolveRead=null;ZXingWASM.readBarcodes=()=>new Promise(resolve=>{window.__resolveRead=resolve;});}""")
   page.locator('#barcode-restart').click();page.wait_for_function("()=>typeof window.__resolveRead==='function'");page.locator('#barcode-stop').click();page.wait_for_function("()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")
   page.evaluate("()=>{window.__resolveRead([{text:'96385074'}]);ZXingWASM.readBarcodes=window.__savedRead;}");page.wait_for_timeout(100);assert page.locator('#barcode-result').inner_text()=='';ok('Arrêt pendant décodage en attente : résultat tardif ignoré, caméra libérée')
   page.evaluate("""()=>{window.__savedEnumerate=navigator.mediaDevices.enumerateDevices;navigator.mediaDevices.enumerateDevices=async()=>[];barcodeCameraPreference('fictional-disappeared-id');window.__beforeFallback=window.__cameraCalls;}""")
   page.locator('#barcode-restart').click();page.wait_for_function("()=>document.getElementById('barcode-result').textContent.includes('4006381333931')")
   page.wait_for_function("()=>window.__streams.every(s=>s.getTracks().every(t=>t.readyState==='ended'))")
   assert page.evaluate('()=>window.__cameraCalls===window.__beforeFallback+2');page.evaluate("()=>{navigator.mediaDevices.enumerateDevices=window.__savedEnumerate;barcodeCameraPreference('');}");ok('Décodeur réel : identifiant inexistant refusé par getUserMedia puis un seul repli réussi')
   page.locator('#barcode-manual-code').fill('96385074');page.locator('#barcode-check').click();assert page.locator('#barcode-product-manual').is_visible()
   page.locator('#barcode-product-manual').click();assert page.locator('#f-barcode').input_value()=='96385074';assert page.evaluate('window.__writes')==0;page.evaluate('()=>closeModal()');ok('Produit inconnu : saisie manuelle préremplie, aucun enregistrement ni requête externe')
   page.evaluate("""()=>{window.__selectedRequests=[];window.Html5Qrcode=class{constructor(){this.isScanning=false;}pause(){}resume(){}start(camera){window.__selectedRequests.push(camera);this.isScanning=true;return Promise.resolve();}stop(){this.isScanning=false;return Promise.resolve();}clear(){}};openScanner();}""")
   page.wait_for_selector('#barcode-camera');page.locator('#barcode-camera').select_option('fictional-ultra')
   page.wait_for_function("()=>window.__selectedRequests.at(-1)?.deviceId?.exact==='fictional-ultra'&&scanRunning")
   page.evaluate('()=>closeScanner()');page.evaluate('()=>openScanner()');page.wait_for_function('()=>scanRunning');assert page.evaluate("()=>window.__selectedRequests.at(-1).deviceId.exact==='fictional-ultra'")
   page.evaluate('()=>closeScanner()');ok('Choix manuel de caméra mémorisé et réutilisé à la réouverture')
   page.evaluate("""()=>{window.__fallbackStarts=[];window.Html5Qrcode=class{constructor(){this.isScanning=false;}pause(){}resume(){}start(camera){window.__fallbackStarts.push(camera);if(camera.deviceId)return Promise.reject(new Error('OverconstrainedError'));this.isScanning=true;return Promise.resolve();}stop(){this.isScanning=false;return Promise.resolve();}clear(){}};openScanner();}""")
   page.wait_for_function('()=>scanRunning&&window.__fallbackStarts.length===2');assert page.evaluate("()=>window.__fallbackStarts[1].facingMode==='environment'");assert 'indisponible' in page.locator('#scan-hint').inner_text();page.evaluate('()=>closeScanner()');ok('Identifiant caméra périmé : un seul repli arrière, message clair, aucune boucle de redémarrage')
   # Controlled error / permission-pending cases, using the same scanner lifecycle.
   page.evaluate("""()=>{window.__stops=0;window.__starts=0;window.Html5Qrcode=class{constructor(){this.isScanning=false;}pause(){}resume(){}start(){window.__starts++;return Promise.reject(new Error('NotAllowedError'));}stop(){window.__stops++;this.isScanning=false;return Promise.resolve();}clear(){}};}""")
   page.evaluate('()=>openScanner()');page.wait_for_function("()=>document.getElementById('scan-hint').textContent.includes('Caméra indisponible')");ok('Refus de caméra : message clair et saisie manuelle disponible')
   page.evaluate("""()=>{window.Html5Qrcode=class{constructor(){this.isScanning=false;}pause(){}resume(){}start(){window.__starts++;return new Promise(resolve=>{window.__resolveCamera=()=>{this.isScanning=true;resolve();};});}stop(){window.__stops++;this.isScanning=false;return Promise.resolve();}clear(){}};window.__resolveCamera=null;openScanner();}""")
   page.wait_for_function('()=>typeof window.__resolveCamera===\'function\'');page.evaluate('()=>{closeScanner();window.__resolveCamera();}');page.wait_for_function('()=>window.__stops>=1');ok('Fermeture pendant permission/démarrage : arrêt dès résolution, aucune caméra laissée active')
   # Simulate a long-lived stream to exercise Stop and visibility cleanup.
   page.evaluate("""()=>{window.Html5Qrcode=class{constructor(){this.isScanning=false;}pause(){}resume(){}start(){this.isScanning=true;return Promise.resolve();}stop(){window.__stops++;this.isScanning=false;return Promise.resolve();}clear(){}};}""")
   page.evaluate('()=>openScanner()');page.wait_for_timeout(100);n=page.evaluate('window.__stops');page.locator('#barcode-stop').click();page.wait_for_function('(n)=>window.__stops>n',arg=n);ok('Bouton Arrêter libère la session caméra')
   page.evaluate("()=>setLang('de')");page.evaluate('()=>openScanner()');page.wait_for_timeout(100);assert page.locator('#barcode-stop').inner_text()=='Stoppen';page.screenshot(path=str(OUT/'scanner-de-393.png'),full_page=True)
   n=page.evaluate('window.__stops');page.evaluate("()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));}");page.wait_for_function('(n)=>window.__stops>n',arg=n);page.evaluate("()=>{delete document.hidden;closeScanner();}");ok('Libellés DE et passage arrière-plan : session arrêtée')
   assert page.evaluate('window.__writes')==0
   page.wait_for_function('()=>navigator.serviceWorker.controller!==null')
   ctx.set_offline(True);page.reload();page.wait_for_selector('#preprod-start-profile')
   assert page.evaluate('()=>typeof Html5Qrcode')=='function'
   result=page.evaluate("""async data=>{const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));const q=new Html5Qrcode('reader',{formatsToSupport:[Html5QrcodeSupportedFormats.EAN_8],verbose:false});try{return (await q.scanFileV2(new File([bytes],'barcode.png',{type:'image/png'}),false)).decodedText;}finally{q.clear();}}""",images['96385074'])
   assert result=='96385074';ctx.set_offline(False);ok('Réouverture hors ligne : bibliothèque en cache et décodage EAN-8 fonctionnel')
   ctx.set_offline(True)
   result=page.evaluate("""async data=>{const engine=await barcodeDecoder(),image=new Image();image.src='data:image/png;base64,'+data;await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(image,0,0);return (await engine.readBarcodes(c.getContext('2d').getImageData(0,0,c.width,c.height),{formats:['EAN-8']}))[0]?.text;}""",images['96385074'])
   assert result=='96385074';ctx.set_offline(False);ok('WASM rechargé et vérifié hors ligne après réouverture, décodage EAN-8 réussi')
   assert not outside,outside;assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'checks':checks,'decoded':decoded,'secondsToDecodeSyntheticCamera':durations,'engine':'Chromium Linux','camera':'synthetic Y4M video; errors also simulated','realIPhoneTested':False,'firebaseRequests':0,'productWrites':0,'externalRequests':outside,'pageErrors':errors},ensure_ascii=False,indent=2)+'\n')
   browser.close()
 finally:server.shutdown();server.server_close()
