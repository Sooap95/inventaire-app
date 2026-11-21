"""Phase 7.1 : vraie UI/IndexedDB/SW Chromium, backend explicitement fictif."""
from pathlib import Path
from http.server import ThreadingHTTPServer
import sys,threading,subprocess,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/phase71';OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT/'scripts'))
from serve_mobile_ui import Handler
subprocess.run(['python3','scripts/build_mobile_ui.py'],cwd=ROOT,check=True)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
checks=[];outside=[];errors=[]
def ok(s):checks.append(s);print('PASS '+s,flush=True)
STATE="""async()=>{const db=await new Promise((r,j)=>{const q=indexedDB.open('inventaire-mobile-ui-intentions-v1');q.onsuccess=()=>r(q.result);q.onerror=j;});const data=await new Promise((r,j)=>{const q=db.transaction('accounts').objectStore('accounts').get(document.querySelector('#device-uid').textContent);q.onsuccess=()=>r(q.result);q.onerror=j;});db.close();return data;}"""
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ctx=browser.new_context(viewport={'width':393,'height':852},has_touch=True,service_workers='allow')
  ctx.on('request',lambda r:outside.append(r.url.split('?')[0]) if r.url.startswith(('http:','https:','ws:','wss:')) and not r.url.startswith(origin+'/') else None)
  p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.goto(origin);p.wait_for_selector('#device-uid');uid=p.locator('#device-uid').text_content();p.locator('#simulation-status').select_option('active');p.wait_for_function('()=>products.length===4');p.wait_for_function('()=>navigator.serviceWorker.controller!==null')
  def card(product='milk'):return p.locator('.product-card').filter(has=p.locator('[data-product-id="'+product+'"]')).first
  def plus(product='milk'):return card(product).locator('[data-product-action=stock][data-delta="1"]')
  def minus(product='milk'):return card(product).locator('[data-product-action=stock][data-delta="-1"]')
  ctx.set_offline(True);plus().click();assert card().locator('.stock-value').inner_text()=='2';assert p.locator('#family-modal').is_hidden();assert p.evaluate("()=>products.find(p=>p.id==='milk').stock")==1
  p.wait_for_function("async()=>{const db=await new Promise(r=>{const q=indexedDB.open('inventaire-mobile-ui-intentions-v1');q.onsuccess=()=>r(q.result)});const s=await new Promise(r=>{const q=db.transaction('accounts').objectStore('accounts').get(document.querySelector('#device-uid').textContent);q.onsuccess=()=>r(q.result)});db.close();return s.outbox.length===1}")
  minus().click();assert card().locator('.stock-value').inner_text()=='1';assert p.locator('#family-modal').is_hidden();ok('Un + puis un − immédiats, aucune confirmation et cache confirmé inchangé hors ligne')
  p.evaluate("()=>{const b=document.querySelector('[data-product-id=milk][data-delta=\"1\"]');for(let i=0;i<20;i++)b.click();}");assert card().locator('.stock-value').inner_text()=='21'
  for _ in range(100):
   state=p.evaluate(STATE)
   if len(state['outbox'])==22:break
   p.wait_for_timeout(20)
  assert len(state['outbox'])==22;assert len({i['command']['operationId'] for i in state['outbox']})==22;assert [i['command']['expectedRevision'] for i in state['outbox']]==list(range(1,23));assert p.locator('#family-modal').is_hidden();ok('20 appuis rapides sur le même élément : tous capturés et persistés avec ID/révisions distincts')
  p.reload();p.wait_for_function('()=>products.length===4');p.locator('[data-tab=inventory]').click();assert p.locator('#device-uid').text_content()==uid;assert card().locator('.stock-value').inner_text()=='21';assert 'En attente' in card().inner_text();assert p.evaluate("()=>products.find(p=>p.id==='milk').stock")==1;ok('Rechargement hors ligne : projection et 22 intentions conservées, stock confirmé inchangé')
  ctx.set_offline(False);p.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===21",timeout=20000)
  for _ in range(100):
   state=p.evaluate(STATE)
   if all(i['status']=='ack' for i in state['outbox']):break
   p.wait_for_timeout(20)
  assert all(i['status']=='ack' for i in state['outbox']);ok('Reconnexion : 22 opérations acquittées, résultat exact sans double effet')
  plus().scroll_into_view_if_needed();box=plus().bounding_box();p.evaluate("()=>window.heldButton=document.querySelector('[data-product-id=milk][data-delta=\"1\"]')");p.mouse.move(box['x']+22,box['y']+22);p.mouse.down()
  p.evaluate("()=>FamilyApp.quickAdjust('milk',1)");p.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===22");assert p.evaluate("()=>heldButton===document.querySelector('[data-product-id=milk][data-delta=\"1\"]')");p.mouse.up();p.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===23");ok('Acquittement pendant un appui tenu : bouton conservé, relâchement compté sans perte')
  before=len(p.evaluate(STATE)['outbox']);minus('butter').click();assert card('butter').locator('.stock-value').inner_text()=='0';assert len(p.evaluate(STATE)['outbox'])==before;plus('butter').click();minus('butter').click();minus('butter').click();p.wait_for_function("()=>FamilyApp.quickStockState('butter').pending===0");assert p.evaluate("()=>products.find(p=>p.id==='butter').stock")==0;ok('Limite zéro : aucun stock négatif, aucun reçu inutile pour un appui sans effet')
  # Échec local injecté : transaction accounts avortée, aucun accès réel.
  p.evaluate("""()=>{window.originalQuickPut=IDBObjectStore.prototype.put;window.failQuickPut=true;IDBObjectStore.prototype.put=function(v,...args){if(this.name==='accounts'&&window.failQuickPut&&v.outbox?.some(i=>i.quickStock&&!['ack','cancelled'].includes(i.status))){window.failQuickPut=false;throw new DOMException('fictional disk full','QuotaExceededError')}return originalQuickPut.call(this,v,...args)};}""")
  plus().click();p.wait_for_function("()=>document.querySelector('.quick-stock-detail').parentElement!==null&&document.querySelector('#quick-storage-retry-milk')!==null");assert p.evaluate("()=>products.find(p=>p.id==='milk').stock")==23;assert 'Appuis non enregistrés' in card().inner_text();p.locator('#quick-storage-retry-milk').click();p.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===24");p.evaluate('()=>IDBObjectStore.prototype.put=originalQuickPut');ok('Erreur de stockage injectée : pas d’écriture serveur, appui gardé et repris une seule fois')
  ctx.set_offline(True);plus().click();assert card().locator('.stock-value').inner_text()=='25'
  for lang in ['fr','de']:
   p.evaluate('(lang)=>setLang(lang)',lang)
   for width,height in [(320,844),(375,812),(393,852),(428,926),(768,1024),(1440,1000)]:
    p.set_viewport_size({'width':width,'height':height});p.locator('[data-tab=inventory]').click();assert p.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1');assert ('En attente' if lang=='fr' else 'Ausstehend') in card().inner_text();p.screenshot(path=str(OUT/f'quick-pending-{lang}-{width}.png'),full_page=True)
  ok('FR/DE et six largeurs : quantité en attente distincte, design conservé et aucun débordement')
  assert not errors,errors;assert not outside,outside
  (OUT/'quick-stock-browser.json').write_text(json.dumps({'checks':checks,'backend':'local IndexedDB fixture; disk error deliberately injected','realPhone':False,'engine':'Chromium','externalRequests':outside,'pageErrors':errors},ensure_ascii=False,indent=2)+'\n');browser.close()
finally:server.shutdown();server.server_close()
