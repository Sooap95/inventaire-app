"""Identités anonymes réelles des émulateurs ; profils Chromium fictifs seulement."""
from pathlib import Path
import subprocess,tempfile,os,time,json,socket
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/phase5';OUT.mkdir(parents=True,exist_ok=True)
checks=[];outside=[];errors=[]
def ok(text):checks.append(text);print('PASS '+text,flush=True)
def run(script,*args):subprocess.run(['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'security/scripts'/script),*args],check=True,cwd=ROOT,env=os.environ)
def admin(uid,action):run('browser-authorize.mjs',uid,action)
run('seed-family.mjs','seed');subprocess.run(['python3','scripts/build_family_lab.py'],cwd=ROOT,check=True)
server=subprocess.Popen(['python3','scripts/serve_family_lab.py'],cwd=ROOT,stdout=subprocess.DEVNULL)
for _ in range(100):
 try:
  with socket.create_connection(('127.0.0.1',8769),timeout=.2):break
 except OSError:time.sleep(.1)
def wait_uid(page):page.wait_for_selector('#device-uid',state='attached');return page.locator('#device-uid').text_content()
def ready(page):page.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('Synchronisé')");page.wait_for_function('()=>document.querySelectorAll(".product-card").length===4')
try:
 with tempfile.TemporaryDirectory(prefix='inventaire-fake-profile-') as profile,sync_playwright() as pw:
  def launch():
   ctx=pw.chromium.launch_persistent_context(profile,executable_path='/usr/bin/chromium',headless=True,viewport={'width':428,'height':926},has_touch=True,args=['--no-sandbox'])
   ctx.on('request',lambda r:outside.append(r.url.split('?')[0]) if r.url.startswith(('http:','https:','ws:','wss:')) and not r.url.startswith(('http://127.0.0.1:8769/','http://127.0.0.1:8180/','http://127.0.0.1:9099/')) else None)
   ctx.on('page',lambda p:p.on('pageerror',lambda e:errors.append(str(e))));return ctx
  ctx=launch();p=ctx.pages[0];p.on('pageerror',lambda e:errors.append(str(e)))
  # Clipboard API mocked deliberately; no phone clipboard validation is claimed.
  p.add_init_script("Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedUid=text}}})")
  p.goto('http://127.0.0.1:8769/');uid=wait_uid(p);p.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('attend')")
  assert p.locator('header [onclick="openAddModal()"]').is_disabled();assert p.evaluate("async()=>{try{await FamilyApp.saveProduct(null);return false}catch(e){return e.message==='device-not-authorized'}}");assert p.locator('.product-card').count()==0;assert p.locator('#family-login,#family-user,#family-logout').count()==0;p.locator('#device-copy').click();assert p.evaluate('()=>copiedUid')==uid;p.screenshot(path=str(OUT/'waiting-fr.png'));ok('Nouveau profil : UID automatique, attente sans inventaire, copie et aucun formulaire de connexion')
  p.evaluate("()=>setLang('de')");assert 'wartet' in p.locator('#family-status').inner_text();p.screenshot(path=str(OUT/'waiting-de.png'));p.evaluate("()=>setLang('fr')");ok('Écran d’attente FR/DE à taille mobile simulée')
  admin(uid,'allow');ready(p);ok('Autorisation administrative reçue automatiquement, aucune action dans la PWA')
  second=ctx.new_page();second.goto('http://127.0.0.1:8769/');assert wait_uid(second)==uid;ready(second);second.close();ok('Deux onglets partagent la même identité')
  ctx.close();ctx=launch();p=ctx.pages[0];p.goto('http://127.0.0.1:8769/');assert wait_uid(p)==uid;ready(p);ok('Fermeture complète du navigateur puis réouverture : UID et accès conservés')
  p.wait_for_function('()=>navigator.serviceWorker.controller!==null');ctx.set_offline(True);p.reload();assert wait_uid(p)==uid;p.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('Hors ligne')");p.evaluate("()=>switchTab('shopping')");p.locator('#family-add').click();p.locator('#family-text').fill('bananes 0,5 kg');p.locator('#family-prepare').click();p.locator('#family-confirm').click();p.wait_for_selector('#family-modal.hidden',state='attached');assert p.locator('#family-queue [data-operation-id]').count()==1;ok('Réouverture hors ligne avec même UID, cache confirmé et intention conservée')
  ctx.set_offline(False);p.wait_for_function('()=>!document.querySelector("#family-queue [data-operation-id]")');ok('Retour réseau : intention acquittée sans bouton de connexion ni double effet')
  admin(uid,'revoke');p.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('révoqué')");assert p.locator('.product-card').count()==0;p.reload();assert wait_uid(p)==uid;p.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('révoqué')");ok('Révocation : même UID conservé et données masquées, y compris après rechargement')
  admin(uid,'allow');ready(p);ok('Réautorisation explicite : reprise automatique du même UID')
  ctx.close()
  # A fresh browser profile represents clearing site data or changing device.
  with tempfile.TemporaryDirectory(prefix='inventaire-new-fake-device-') as fresh:
   new=pw.chromium.launch_persistent_context(fresh,executable_path='/usr/bin/chromium',headless=True,viewport={'width':393,'height':852},args=['--no-sandbox']);new.on('request',lambda r:outside.append(r.url.split('?')[0]) if r.url.startswith(('http:','https:')) and not r.url.startswith(('http://127.0.0.1:8769/','http://127.0.0.1:8180/','http://127.0.0.1:9099/')) else None)
   page=new.pages[0];page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:8769/');new_uid=wait_uid(page);assert new_uid!=uid;page.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('attend')");assert page.locator('.product-card').count()==0;ok('Effacement simulé par profil vierge : nouvel UID, aucune reprise implicite de l’autorisation')
   admin(new_uid,'allow');ready(page);page.evaluate("()=>switchTab('shopping')");page.wait_for_function("()=>document.querySelector('#shopping-list-content').textContent.includes('bananes')");admin(uid,'revoke');ready(page);ok('Nouvel appareil autorisé : données familiales intactes et ancien UID révocable séparément')
   new.close()
  assert not outside,outside;assert not errors,errors;ok('Aucune requête externe, aucune erreur JavaScript')
  (OUT/'devices-browser.json').write_text(json.dumps({'checks':checks,'realPhones':False,'engine':'Chromium','externalRequests':outside,'pageErrors':errors,'clipboard':'simulated','identityLoss':'fresh browser profile','persistentProfileRestart':True},indent=2,ensure_ascii=False))
finally:server.terminate();server.wait(timeout=5)
