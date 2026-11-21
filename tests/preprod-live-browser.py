"""Real Chromium + local TLS origin, no real Firebase; real phones remain untested."""
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
import json,ssl,subprocess,tempfile,threading
from playwright.sync_api import sync_playwright
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from build_preprod_live import CSP
D=ROOT/'dist/preprod-live';OUT=ROOT/'test-results/preprod-live';OUT.mkdir(parents=True,exist_ok=True)
ORIGIN='https://inventaire-maison-v02-recette-sync.pages.dev'
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(D),**kwargs)
 def translate_path(self,path):
  value=super().translate_path(path);return value+'.html' if not Path(value).exists() and Path(value+'.html').is_file() else value
 def log_message(self,*args):pass
 def list_directory(self,path):self.send_error(403)
 def end_headers(self):
  self.send_header('Content-Security-Policy',CSP);self.send_header('Cache-Control','no-cache');super().end_headers()

with tempfile.TemporaryDirectory() as tmp:
 cert,key=Path(tmp)/'cert.pem',Path(tmp)/'key.pem'
 subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','1','-subj','/CN=inventaire-maison-v02-recette-sync.pages.dev'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 server=ThreadingHTTPServer(('127.0.0.1',443),Handler)
 tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);tls.load_cert_chain(cert,key);server.socket=tls.wrap_socket(server.socket,server_side=True)
 threading.Thread(target=server.serve_forever,daemon=True).start()
 try:
  with sync_playwright() as pw:
   browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox','--no-proxy-server','--ignore-certificate-errors','--host-resolver-rules=MAP inventaire-maison-v02-recette-sync.pages.dev 127.0.0.1'])
   context=browser.new_context(ignore_https_errors=True,viewport={'width':393,'height':852},has_touch=True)
   blocked=[];errors=[]
   def route(r):
    if r.request.url.startswith(ORIGIN+'/'):r.continue_()
    else:blocked.append(r.request.url.split('?')[0]);r.abort()
   context.route('**/*',route)
   page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
   response=page.goto(ORIGIN+'/');assert 'firestore.googleapis.com' in response.headers['content-security-policy']
   page.wait_for_selector('#preprod-start-profile');assert page.locator('.product-card').count()==0
   assert page.locator('header [onclick="openAddModal()"]').is_disabled()
   assert page.evaluate('async()=> (await indexedDB.databases()).length')==0
   assert not blocked,blocked
   print('PASS ouverture passive HTTPS locale : aucun SDK Auth, identité ou stock',flush=True)
   for width in [320,375,393,428,768,1440]:
    page.set_viewport_size({'width':width,'height':852})
    for lang in ['fr','de']:
     page.evaluate('(lang)=>setLang(lang)',lang)
     for tab in ['inventory','shopping','scanner','more']:
      page.evaluate('(tab)=>switchTab(tab)',tab)
      assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,lang,tab)
     page.evaluate("()=>switchTab('inventory')")
     page.screenshot(path=str(OUT/f'live-{lang}-{width}.png'),full_page=True)
   print('PASS FR/DE : 6 largeurs et 4 onglets, aucune erreur ni dépassement',flush=True)
   page.wait_for_function('()=>navigator.serviceWorker.controller!==null');page.reload();page.wait_for_selector('#preprod-start-profile')
   context.set_offline(True);page.reload();page.wait_for_selector('#preprod-start-profile');assert page.locator('.product-card').count()==0;context.set_offline(False)
   print('PASS réouverture hors ligne du shell et garde avant identification',flush=True)
   assert not errors,errors
   # Deliberate simulated failure after opt-in. Every nonlocal request is aborted.
   page.locator('#preprod-start-profile').click();page.wait_for_selector('#family-panel');page.wait_for_timeout(1500)
   assert blocked and all(url.startswith('https://identitytoolkit.googleapis.com/') for url in blocked),blocked
   assert page.locator('.product-card').count()==0
   print('PASS identification déclenchée uniquement après action ; erreur Auth simulée sans accès métier',flush=True)
   previous=len(blocked);page.reload();page.wait_for_selector('#family-panel')
   for _ in range(20):
    if len(blocked)>previous:break
    page.wait_for_timeout(250)
   assert page.locator('#preprod-start-profile').is_hidden(),'Initial opt-in still visible on reopen'
   assert len(blocked)>previous,'Persistent opt-in did not resume identification'
   assert page.locator('.product-card').count()==0
   print('PASS réouverture après accord initial : reprise automatique sans nouvelle action de connexion',flush=True)
   assert not errors,errors
   (OUT/'results.json').write_text(json.dumps({'backend':'static TLS local; Auth requests aborted; no real Firebase','realPhone':False,'cloudTest':False,'screenshots':12,'viewports':[320,375,393,428,768,1440],'pageErrors':errors,'blockedRequests':blocked},ensure_ascii=False,indent=2)+'\n')
   browser.close()
 finally:server.shutdown();server.server_close()
