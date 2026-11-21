"""Deux vrais clients Firebase sur émulateurs fictifs, aucun endpoint réel."""
from pathlib import Path
import subprocess,time,socket,os,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/phase71';OUT.mkdir(parents=True,exist_ok=True)
checks=[];outside=[];errors=[]
def run(script,*args):subprocess.run(['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'security/scripts'/script),*args],cwd=ROOT,env=os.environ,check=True)
def ok(s):checks.append(s);print('PASS '+s,flush=True)
STATE="""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('inventaire-family-emulator-v1');q.onsuccess=()=>r(q.result)});const s=await new Promise(r=>{const q=db.transaction('accounts').objectStore('accounts').get(document.querySelector('#device-uid').textContent);q.onsuccess=()=>r(q.result)});db.close();return s;}"""
run('seed-family.mjs','seed');subprocess.run(['python3','scripts/build_family_lab.py'],cwd=ROOT,check=True);server=subprocess.Popen(['python3','scripts/serve_family_lab.py'],cwd=ROOT,stdout=subprocess.DEVNULL)
for _ in range(100):
 try:
  with socket.create_connection(('127.0.0.1',8769),timeout=.2):break
 except OSError:time.sleep(.1)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']);ac=browser.new_context(viewport={'width':428,'height':926},has_touch=True);bc=browser.new_context(viewport={'width':393,'height':852},has_touch=True)
  for ctx in [ac,bc]:
   ctx.on('request',lambda r:outside.append(r.url.split('?')[0]) if r.url.startswith(('http:','https:','ws:','wss:')) and not r.url.startswith(('http://127.0.0.1:8769/','http://127.0.0.1:8180/','http://127.0.0.1:9099/')) else None)
  a=ac.new_page();b=bc.new_page()
  for p in [a,b]:
   p.on('pageerror',lambda e:errors.append(str(e)));p.goto('http://127.0.0.1:8769/');p.wait_for_function("()=>document.querySelector('#family-status')?.textContent.includes('attend')");uid=p.locator('#device-uid').text_content();run('browser-authorize.mjs',uid,'allow');p.wait_for_function('()=>products.length===4')
  uid=a.locator('#device-uid').text_content()
  def card(p):return p.locator('.product-card[data-id=milk]')
  def plus(p):return card(p).locator('[data-product-action=stock][data-delta="1"]')
  plus(a).click();a.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===2");b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===2");assert a.locator('#family-modal').is_hidden();ok('Un + sans confirmation, écriture product.write réelle sur émulateur et second client à jour')
  a.evaluate("()=>{for(const d of [1,1,1,-1,1])document.querySelector('[data-product-id=milk][data-delta=\"'+d+'\"]').click()}");b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===5",timeout=20000);a.wait_for_function("()=>window.FamilyApp?.quickStockState('milk')?.pending===0");ok('Série rapide de cinq appuis : résultat exact partagé, aucune révision perdue')
  a.wait_for_function('()=>navigator.serviceWorker.controller!==null');ac.set_offline(True);a.evaluate("()=>{const q=document.querySelector('[data-product-id=milk][data-delta=\"1\"]');q.click();q.click();q.click()}")
  for _ in range(100):
   state=a.evaluate(STATE)
   if len([i for i in state['outbox'] if i['status'] not in ['ack','cancelled']])==3:break
   a.wait_for_timeout(20)
  assert len([i for i in state['outbox'] if i['status'] not in ['ack','cancelled']])==3
  b.evaluate("()=>openEditModal('milk')");b.locator('#f-stock').fill('10');b.locator('#modal-save-btn').click();b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===10")
  a.reload();a.wait_for_function('()=>products.length===4');assert card(a).locator('.stock-value').inner_text()=='8';ac.set_offline(False);a.wait_for_function("()=>window.FamilyApp?.quickStockState('milk')?.blocked==='conflict'",timeout=20000);a.wait_for_function("()=>document.querySelector('#last-update').textContent==='À revoir'");assert card(a).locator('.stock-value').inner_text()=='10';assert plus(a).is_disabled();assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==10;a.screenshot(path=str(OUT/'quick-conflict-fr.png'),full_page=True);ok('Concurrence réelle : trois appuis hors ligne conservés, stock distant 10 préservé, chaîne bloquée explicitement')
  card(a).get_by_role('button',name='Revoir les appuis conservés',exact=True).click();a.wait_for_selector('#quick-review-apply');assert '13 L' in a.locator('#family-modal').inner_text();assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==10;a.locator('#quick-review-apply').click();b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===13");a.wait_for_function("()=>window.FamilyApp?.quickStockState('milk')?.pending===0");ok('Réexamen puis validation : trois gestes appliqués une seule fois depuis le stock confirmé 10 → 13')
  # Une intention déjà écrite, retrouvée comme suspendue : simule un import ancien.
  a.evaluate("""async()=>{const db=await new Promise(r=>{const q=indexedDB.open('inventaire-family-emulator-v1');q.onsuccess=()=>r(q.result)});await new Promise((r,j)=>{const tx=db.transaction('accounts','readwrite'),os=tx.objectStore('accounts'),q=os.get(document.querySelector('#device-uid').textContent);q.onsuccess=()=>{const s=q.result,i=s.outbox.filter(i=>i.quickStock&&i.status==='ack').at(-1);i.status='held';s.revision++;os.put(s)};tx.oncomplete=r;tx.onabort=j});db.close()}""")
  a.reload();a.wait_for_function("()=>window.FamilyApp?.quickStockState('milk')?.blocked==='held'");card(a).get_by_role('button',name='Revoir les appuis conservés',exact=True).click();a.wait_for_selector('#quick-review-apply');assert '0 appui(s)' in a.locator('#family-modal').inner_text();a.locator('#quick-review-apply').click();a.wait_for_function("()=>window.FamilyApp?.quickStockState('milk')?.pending===0");assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==13;ok('Reçu v2 retrouvé et hash vérifié : intention restaurée déjà appliquée acquittée, aucun double stock')
  # Les parcours sensibles existants ne sont pas transformés en gestes immédiats.
  a.evaluate("()=>deleteProduct('milk')");assert a.locator('#family-modal').is_visible();assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==13;a.locator('#family-modal .modal-footer button').first.click()
  a.evaluate("()=>{openQuickModal('milk');quickAdjust(1);saveQuickUpdate()}");assert a.locator('#family-modal').is_visible();assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==13;a.locator('#family-modal .modal-footer button').first.click();ok('Suppression et correction manuelle/scanner gardent leur validation explicite')
  ac.set_offline(True);plus(a).click()
  for _ in range(100):
   if any(i['status']=='pending' for i in a.evaluate(STATE)['outbox']):break
   a.wait_for_timeout(20)
  run('browser-authorize.mjs',uid,'revoke');ac.set_offline(False);a.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('révoqué')");assert a.locator('.product-card').count()==0;assert b.evaluate("()=>products.find(p=>p.id==='milk').stock")==13
  run('browser-authorize.mjs',uid,'allow');b.wait_for_function("()=>products.find(p=>p.id==='milk')?.stock===14",timeout=20000);a.wait_for_function("()=>window.FamilyApp?.quickStockState('milk')?.pending===0");ok('Révocation : aucun envoi non autorisé ; réautorisation du même UID reprend l’intention une fois')
  run('seed-family.mjs','backup');backup=json.loads((ROOT/'security/.cache/family-admin-backup.json').read_text());events=[e['data'] for e in backup['collections']['operations']];assert len({e['id'] for e in events})==len(events);assert all(e['action']=='product.write' for e in events);assert len(events)==9,len(events)
  assert not outside,outside;assert not errors,errors
  (OUT/'quick-stock-emulator-browser.json').write_text(json.dumps({'checks':checks,'backend':'real Firebase SDK, local Auth/Firestore emulators','realPhone':False,'externalRequests':outside,'pageErrors':errors,'operations':len(events)},ensure_ascii=False,indent=2)+'\n');browser.close()
finally:server.terminate();server.wait(timeout=5)
