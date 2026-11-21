"""Paquet niveau 2 inactif réel, Chromium/worker/IndexedDB ; aucun Firebase réel."""
from pathlib import Path
import subprocess,time,socket,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/phase8a2l';OUT.mkdir(exist_ok=True,parents=True)
subprocess.run(['python3','scripts/build_preprod_local.py'],cwd=ROOT,check=True)
server=subprocess.Popen(['python3','scripts/serve_preprod_local.py'],cwd=ROOT,stdout=subprocess.DEVNULL);checks=[];outside=[];errors=[]
def ok(text):checks.append(text);print('PASS '+text,flush=True)
for _ in range(100):
 try:
  with socket.create_connection(('127.0.0.1',8772),timeout=.2):break
 except OSError:time.sleep(.05)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);context=browser.new_context(viewport={'width':393,'height':852},has_touch=True)
  def route(r):
   if r.request.url.startswith(('http:','https:','ws:','wss:')) and not r.request.url.startswith('http://127.0.0.1:8772/'):
    outside.append(r.request.url.split('?')[0]);r.abort()
   else:r.continue_()
  context.route('**/*',route);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('http://127.0.0.1:8772/');page.wait_for_selector('#preprod-gate-status');assert 'désactivée' in page.locator('#preprod-gate-status').inner_text();assert page.locator('#preprod-gate-status').get_attribute('data-code')=='PREPROD_WEB_APP_REQUIRED';assert page.locator('.product-card').count()==0;assert page.locator('header [onclick="openAddModal()"]').is_disabled();assert page.locator('#device-uid').count()==0
  assert page.evaluate('async()=> (await indexedDB.databases()).length')==0;ok('Configuration Web absente : refus avant SDK/identité, aucun inventaire ni action produit')
  page.evaluate("""()=>window.PREPROD_BINDING={...window.PREPROD_BINDING,firebase:{apiKey:'AIza'+'x'.repeat(35),appId:'1:319106753418:web:abcdef0123456789',authDomain:'inventaire-v02-preprod-a1.firebaseapp.com'}}""")
  page.evaluate("()=>import('/src/preprod/preprod.bundle.js')");page.wait_for_selector('#family-panel');assert page.locator('#family-tools h2').inner_text()=='Famille — PRÉPRODUCTION';assert page.locator('#device-uid').count()==0;assert page.locator('.product-card').count()==0
  assert not any('firebase' in d['name'].lower() for d in page.evaluate('async()=>await indexedDB.databases()'));ok('SDK chargé volontairement dans le test avec liaison fictive complète : origine locale refusée, aucun compte Auth créé')
  for width in [320,375,393,428,768,1440]:
   page.set_viewport_size({'width':width,'height':852})
   for lang in ['fr','de']:
    page.evaluate('(lang)=>setLang(lang)',lang);page.evaluate("()=>switchTab('inventory')");assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(width,lang)
    assert page.locator('#family-tools h2').inner_text()==('Famille — PRÉPRODUCTION' if lang=='fr' else 'Familie — VORPRODUKTION')
    if width==393:page.screenshot(path=str(OUT/f'inactive-{lang}-393.png'),full_page=True)
  ok('Six largeurs FR/DE, libellés préproduction et Art déco sans erreur ni débordement horizontal')
  page.wait_for_function('()=>navigator.serviceWorker.controller!==null');page.reload();page.wait_for_selector('#preprod-gate-status');context.set_offline(True);page.reload();page.wait_for_selector('#preprod-gate-status');assert page.locator('#device-uid').count()==0;context.set_offline(False);ok('Réouverture hors ligne du shell : garde inactive et absence d’identité conservées')
  page.evaluate("""async()=>{await (await caches.open('inventaire-mobile-ui-preserve-test')).put('/keep',new Response('fictional'));const db=await new Promise(r=>{const q=indexedDB.open('fictional-preserve',1);q.onupgradeneeded=()=>q.result.createObjectStore('x');q.onsuccess=()=>r(q.result)});db.close()}""")
  page.on('dialog',lambda d:d.accept());page.locator('details').first.locator('summary').click();page.locator('#preprod-uninstall').click();page.wait_for_function("async()=>!(await caches.keys()).some(k=>k.startsWith('inventaire-preprod-'))")
  assert page.evaluate("async()=>(await caches.keys()).includes('inventaire-mobile-ui-preserve-test')");assert page.evaluate("async()=>(await indexedDB.databases()).some(d=>d.name==='fictional-preserve')");assert page.evaluate('async()=>(await navigator.serviceWorker.getRegistrations()).length')==0;ok('Retrait ciblé du worker/cache préproduction : autre cache et IndexedDB conservés')
  assert not outside,outside;assert not errors,errors
  (OUT/'preprod-inactive-browser.json').write_text(json.dumps({'checks':checks,'backend':'inactive level 2 package; no Firebase requests','engine':'Chromium Linux','realPhone':False,'cloudTest':False,'externalRequests':outside,'pageErrors':errors,'viewports':[320,375,393,428,768,1440]},ensure_ascii=False,indent=2)+'\n');browser.close()
finally:server.terminate();server.wait(timeout=5)
