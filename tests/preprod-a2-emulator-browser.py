"""Runtime de présentation A2 + cœurs communs sur vrais SDK/émulateurs locaux."""
from pathlib import Path
import subprocess,time,socket,os,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/phase8a2l';OUT.mkdir(exist_ok=True,parents=True)
checks=[];outside=[];errors=[]
def admin(script,*args):subprocess.run(['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'security/scripts'/script),*args],cwd=ROOT,env=os.environ,check=True)
def ok(text):checks.append(text);print('PASS '+text,flush=True)
admin('seed-family.mjs','seed');subprocess.run(['python3','scripts/build_preprod_emulator_test.py'],cwd=ROOT,check=True)
server=subprocess.Popen(['python3','scripts/serve_preprod_emulator_test.py'],cwd=ROOT,stdout=subprocess.DEVNULL)
for _ in range(100):
 try:
  with socket.create_connection(('127.0.0.1',8773),timeout=.2):break
 except OSError:time.sleep(.1)
STATE="""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('inventaire-preprod-test-intentions-v1');q.onsuccess=()=>r(q.result)});const state=await new Promise(r=>{const q=db.transaction('accounts').objectStore('accounts').get(document.querySelector('#device-uid').textContent);q.onsuccess=()=>r(q.result)});db.close();return state;}"""
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ac=browser.new_context(viewport={'width':393,'height':852},has_touch=True);bc=browser.new_context(viewport={'width':428,'height':926},has_touch=True)
  for ctx in [ac,bc]:
   ctx.on('request',lambda r:outside.append(r.url.split('?')[0]) if r.url.startswith(('http:','https:','ws:','wss:')) and not r.url.startswith(('http://127.0.0.1:8773/','http://127.0.0.1:8180/','http://127.0.0.1:9099/')) else None)
  a=ac.new_page();b=bc.new_page()
  for p in [a,b]:
   p.on('pageerror',lambda e:errors.append(str(e)));p.goto('http://127.0.0.1:8773/');p.wait_for_function("()=>document.querySelector('#family-status')?.textContent.includes('attend')");assert p.locator('.product-card').count()==0
  auid=a.locator('#device-uid').inner_text();buid=b.locator('#device-uid').inner_text();assert auid!=buid;ok('Deux profils Auth anonymes distincts sur émulateur, nouveaux membres en attente sans accès produit')
  admin('browser-authorize.mjs',auid,'allow');a.wait_for_function('()=>products.length===4');assert b.locator('.product-card').count()==0;admin('browser-authorize.mjs',buid,'allow');b.wait_for_function('()=>products.length===4');ok('Autorisation administrative fictive, un profil à la fois, aucun pouvoir client sur members')
  a.evaluate("()=>{for(const d of [1,1,1,-1,1])document.querySelector('[data-product-id=milk][data-delta=\"'+d+'\"]').click()}");b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===4");a.wait_for_function("()=>FamilyApp.quickStockState('milk').pending===0");assert a.locator('#family-modal').is_hidden();ok('Cinq gestes rapides, résultat confirmé 4 L partagé, aucune confirmation ni perte')
  admin('seed-family.mjs','backup');before_diagnostics=json.loads((ROOT/'security/.cache/family-admin-backup.json').read_text())
  a.locator('#family-tools').evaluate('n=>n.open=true');a.locator('#family-diagnostics').click();diag=json.loads(a.locator('#family-modal pre').inner_text());assert diag['observedLocal']['outboxEntries']==5;assert diag['serverBillingCounters'] is None;assert auid not in a.locator('#family-modal pre').inner_text();a.locator('#family-modal .modal-footer button').first.click()
  b.evaluate("()=>setLang('de')");assert b.locator('#family-tools h2').inner_text()=='Familie — VORPRODUKTION';b.locator('#family-tools').evaluate('n=>n.open=true');b.locator('#family-diagnostics').click();assert b.locator('#family-modal h3').inner_text()=='Lokale aggregierte Diagnose';b.locator('#family-modal .modal-footer button').first.click();b.screenshot(path=str(OUT/'emulator-de-428.png'),full_page=True);b.evaluate("()=>setLang('fr')");admin('seed-family.mjs','backup');assert json.loads((ROOT/'security/.cache/family-admin-backup.json').read_text())==before_diagnostics;ok('Diagnostics agrégés sur demande sans UID ni écritures de rendu, libellés FR/DE exacts')
  a.wait_for_function('()=>navigator.serviceWorker.controller!==null');ac.set_offline(True);a.evaluate("()=>{const b=document.querySelector('[data-product-id=milk][data-delta=\"1\"]');b.click();b.click();b.click()}")
  for _ in range(100):
   if len([i for i in a.evaluate(STATE)['outbox'] if i['status']=='pending'])==3:break
   a.wait_for_timeout(20)
  assert len([i for i in a.evaluate(STATE)['outbox'] if i['status']=='pending'])==3
  b.evaluate("()=>openEditModal('milk')");b.locator('#f-stock').fill('10');b.locator('#modal-save-btn').click();b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===10")
  a.reload();a.wait_for_function('()=>products.length===4')
  a.wait_for_function("expected=>document.querySelector('#device-uid')?.textContent===expected",arg=auid)
  assert a.locator('#device-uid').text_content()==auid
  a.wait_for_function("()=>document.querySelector('.product-card[data-id=milk] .stock-value')?.textContent==='7'")
  assert a.locator('.product-card[data-id=milk] .stock-value').text_content()=='7'
  ac.set_offline(False);a.wait_for_function("()=>FamilyApp.quickStockState('milk').blocked==='conflict'",timeout=20000)
  a.locator('.product-card[data-id=milk]').get_by_role('button',name='Revoir les appuis conservés',exact=True).click();a.wait_for_selector('#quick-review-apply');assert '13 L' in a.locator('#family-modal').inner_text();a.locator('#quick-review-apply').click();b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===13");a.wait_for_function("()=>FamilyApp.quickStockState('milk').pending===0");ok('Offline et réouverture : UID/intentions persistés, conflit distant 10 L, revue explicite vers 13 L sans doublon')
  a.evaluate("()=>switchTab('shopping')");b.evaluate("()=>switchTab('shopping')");a.locator('#family-add').click();a.locator('#family-text').fill('lait x3');a.locator('#family-prepare').click();a.locator('#family-confirm').click();a.wait_for_selector('#family-modal.hidden',state='attached');b.wait_for_function("()=>document.querySelector('[data-family-row=product_milk]')?.textContent.includes('3 L')")
  def row(p):return p.locator('#shopping-list-content [data-family-row=product_milk]')
  row(a).locator('.family-top input').check();b.wait_for_function("()=>document.querySelector('[data-family-row=product_milk] .family-top input').checked");assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==13
  row(a).get_by_role('button',name='Enregistrer un achat',exact=True).click();a.locator('#family-bought').fill('1,5');a.locator('#family-confirm').click();b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===14.5")
  row(b).get_by_role('button',name='Achats récents',exact=True).click();b.get_by_role('button',name='Annuler cet achat',exact=True).click();assert b.locator('#family-modal input[type=radio]:checked').count()==0;b.locator('#family-modal input[value=add_extra]').check();b.locator('#family-confirm').click();a.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===13");ok('Courses manuelles sans effet stock, coche distincte, achat partiel 1,5 L et compensation explicite par l’autre profil')
  a.evaluate("()=>switchTab('inventory')");b.evaluate("()=>switchTab('inventory')");ac.set_offline(True);a.locator('[data-product-id=milk][data-delta="1"]').click()
  for _ in range(100):
   if any(i['status']=='pending' for i in a.evaluate(STATE)['outbox']):break
   a.wait_for_timeout(20)
  admin('browser-authorize.mjs',auid,'revoke');ac.set_offline(False);a.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('révoqué')");assert a.locator('.product-card').count()==0;assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==13
  admin('browser-authorize.mjs',auid,'allow');b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===14",timeout=20000);a.wait_for_function("()=>FamilyApp.quickStockState('milk').pending===0");ok('Révocation bloque l’intention hors ligne ; réautorisation fictive reprend le même geste une seule fois')
  a.screenshot(path=str(OUT/'emulator-fr-393.png'),full_page=True);admin('seed-family.mjs','backup');admin('seed-family.mjs','restore');admin('seed-family.mjs','check-restore');ok('Export des quatre collections fictives et restauration idempotente, aucune modification du stock')
  backup=json.loads((ROOT/'security/.cache/family-admin-backup.json').read_text());events=[e['data'] for e in backup['collections']['operations']];assert len({e['id'] for e in events})==len(events);assert not outside,outside;assert not errors,errors
  (OUT/'preprod-emulator-browser.json').write_text(json.dumps({'checks':checks,'backend':'real Auth/Firestore SDKs against local emulators, preprod presentation test runtime','realPhone':False,'realCloud':False,'externalRequests':outside,'pageErrors':errors,'operations':[{'id':e['id'],'action':e['action'],'beforeRevision':e['beforeRevision'],'afterRevision':e['afterRevision']} for e in events]},ensure_ascii=False,indent=2)+'\n');browser.close()
finally:server.terminate();server.wait(timeout=5)
