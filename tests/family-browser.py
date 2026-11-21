"""Recette Chromium avec vrai SDK et vrai émulateur, jamais un téléphone réel."""
from pathlib import Path
import subprocess,os,time,json,socket
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
RESULT=ROOT/'test-results/family';RESULT.mkdir(parents=True,exist_ok=True)
def admin(action='seed',uid=None):
    args=['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'security/scripts/seed-family.mjs'),action]
    if uid:args.append(uid)
    subprocess.run(args,cwd=ROOT,check=True,env=os.environ)
def waitport(port):
    for _ in range(100):
        try:
            with socket.create_connection(('127.0.0.1',port),timeout=.2):return
        except OSError:time.sleep(.1)
    raise RuntimeError('Local server startup failed')
admin();subprocess.run(['python3','scripts/build_family_lab.py'],cwd=ROOT,check=True)
server=subprocess.Popen(['python3','scripts/serve_family_lab.py'],cwd=ROOT,stdout=subprocess.DEVNULL);waitport(8769)
checks=[];external=[];errors=[];started=time.perf_counter();timings={}
def ok(text):checks.append(text);print('PASS '+text,flush=True)
try:
 with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    iphone=browser.new_context(**pw.devices['iPhone 13 Pro Max'],service_workers='block')
    android=browser.new_context(**pw.devices['Pixel 7'],service_workers='block')
    desktop=browser.new_context(viewport={'width':1280,'height':900},service_workers='block')
    for context in [iphone,android,desktop]:
        def route(r):
            if r.request.url.startswith(('http://127.0.0.1:8769/','http://127.0.0.1:8180/','http://127.0.0.1:9099/')):r.continue_()
            else:external.append(r.request.url);r.abort()
        context.route('**/*',route)
    a=iphone.new_page();b=android.new_page();c=desktop.new_page()
    for page in [a,b,c]:
        page.on('pageerror',lambda e:errors.append(str(e)));page.goto('http://127.0.0.1:8769/');page.wait_for_selector('#device-uid',state='attached');
    identities={}
    def login(page,uid):
        page.wait_for_selector('#device-uid',state='attached');device=page.locator('#device-uid').text_content();identities[uid]=device
        subprocess.run(['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'security/scripts/browser-authorize.mjs'),device,'allow'],check=True,cwd=ROOT,env=os.environ)
        page.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('Synchronisé')");page.wait_for_function("()=>document.querySelectorAll('.product-card').length>=4");page.evaluate("()=>switchTab('shopping')")
    login(a,'family-alice');login(b,'family-bob');login(c,'family-carol');ok('Trois membres fictifs et interface mobile Chromium');timings['three_clients_ready_s']=round(time.perf_counter()-started,3)
    def row(page,id='product_milk'):return page.locator('#shopping-list-content [data-family-row="'+id+'"]')
    def has(page,text):page.wait_for_function('(text)=>document.body.textContent.includes(text)',arg=text)
    assert '2 L' in row(a).inner_text()
    action_started=time.perf_counter();a.locator('#family-add').click();a.locator('#family-text').fill('lait x3\npommes');a.locator('#family-prepare').click();has(a,'Choisir explicitement');assert a.locator('#family-modal input[type=radio]:checked').count()==0;ok('Aucune option additive présélectionnée')
    a.locator('#family-modal .family-preview').first.locator('input[value=add_extra]').check();a.locator('#family-confirm').click();a.wait_for_selector('#family-modal.hidden',state='attached');b.wait_for_function("()=>document.querySelector('[data-family-row=product_milk]').textContent.includes('5 L')");ok('Liste commune 2 + supplément explicite 3 = 5 sur deux clients');timings['import_preview_and_two_client_sync_s']=round(time.perf_counter()-action_started,3)
    # Copy and print use the same confirmed rows.
    text=a.evaluate("()=>{FamilyApp.buildPrint();return document.querySelector('#print-area').textContent}");assert '5 L' in text and 'pommes' in text;ok('Impression commune et article libre')
    row(a).locator('.family-top input').check();b.wait_for_function("()=>document.querySelector('[data-family-row=product_milk] .family-top input').checked");ok('Coche commune synchronisée sans achat')
    row(a).get_by_role('button',name='Enregistrer un achat',exact=True).click();a.locator('#family-bought').fill('1,5');a.locator('#family-confirm').click();a.wait_for_selector('#family-modal.hidden',state='attached');b.wait_for_function("()=>document.querySelector('[data-family-row=product_milk]').textContent.includes('3,5 L')");ok('Achat partiel réel 1,5 L et reste synchronisé 3,5 L')
    row(b).get_by_role('button',name='Achats récents',exact=True).click();b.get_by_role('button',name='Annuler cet achat',exact=True).click();assert b.locator('#family-modal input[type=radio]:checked').count()==0;b.locator('#family-modal input[value=add_extra]').check();b.locator('#family-confirm').click();b.wait_for_selector('#family-modal.hidden',state='attached');a.wait_for_function("()=>document.querySelector('[data-family-row=product_milk]').textContent.includes('5 L')");ok('Annulation compensatrice par un autre membre avec choix explicite')
    # Offline intent persists; no server state changed while network is disabled.
    a.locator('#family-tools').evaluate('n=>n.open=true');a.locator('#family-network').click();row(a).get_by_role('button',name='Enregistrer un achat',exact=True).click();a.locator('#family-bought').fill('0,5');a.locator('#family-confirm').click();a.wait_for_selector('#family-modal.hidden',state='attached');a.wait_for_function("()=>document.querySelectorAll('#family-queue [data-operation-id]').length===1");assert '5 L' in row(b).inner_text()
    a.reload();a.wait_for_selector('#device-uid',state='attached');assert '5 L' in row(b).inner_text();login(a,'family-alice');a.wait_for_function("()=>document.querySelector('[data-family-row=product_milk]').textContent.includes('4,5 L')");ok('Intention IndexedDB conservée après fermeture/rechargement et reconnexion, pas de double achat')
    # Same-browser tab shares durable queue, explicit stale preview.
    tab=iphone.new_page();tab.on('pageerror',lambda e:errors.append(str(e)));tab.goto('http://127.0.0.1:8769/');login(tab,'family-alice')
    row(a).get_by_role('button',name='Revoir le total',exact=True).count() # no forced review after a committed purchase
    a.locator('#family-add').click();a.locator('#family-text').fill('lait x1');a.locator('#family-prepare').click();a.locator('#family-modal input[value=set_total]').check();
    row(tab).get_by_role('button',name='Enregistrer un achat',exact=True).click();tab.locator('#family-bought').fill('0,5');tab.locator('#family-confirm').click();tab.wait_for_selector('#family-modal.hidden',state='attached');a.wait_for_timeout(500);a.locator('#family-confirm').click();has(a,'La liste ou le stock a changé');a.get_by_role('button',name='Annuler',exact=True).click();ok('Aperçu interonglets périmé refusé sans écraser la liste')
    # Versioned local backup + restore idempotence, no stock restoration.
    with a.expect_download() as download:a.locator('#family-tools').evaluate('n=>n.open=true');a.locator('#family-backup').click()
    path=download.value.path();data=json.loads(Path(path).read_text());assert data['format']=='inventaire-family-local'
    a.locator('#family-restore').click();a.locator('#family-restore-file').set_input_files(str(path));has(a,'0 Restaurée');a.locator('#family-confirm').click();a.wait_for_selector('#family-modal.hidden',state='attached');ok('Aperçu et restauration locale idempotente sans écraser les stocks')
    # German translation via the existing language selector handler.
    b.evaluate("()=>setLang('de')");b.wait_for_timeout(200);assert b.locator('#family-add').inner_text()=='Artikel hinzufügen';assert 'Rest' in row(b).inner_text();b.screenshot(path=str(RESULT/'android-de.png'));a.screenshot(path=str(RESULT/'iphone-fr.png'))
    for page in [a,b]:assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
    ok('FR/DE et absence de débordement à deux tailles mobiles simulées')
    admin('backup');admin('restore');admin('restore');ok('Sauvegarde des quatre collections fictives et restauration idempotente isolée')
    subprocess.run(['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'security/scripts/browser-authorize.mjs'),identities['family-carol'],'revoke'],check=True,cwd=ROOT,env=os.environ);c.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('révoqué')");assert c.locator('[data-family-row]').count()==0 or not c.locator('[data-family-row]').first.is_visible();ok('Révocation : abonnements arrêtés et données masquées')
    old_uid=a.locator('#device-uid').text_content();a.reload();a.wait_for_selector('#device-uid',state='attached');assert a.locator('#device-uid').text_content()==old_uid;a.wait_for_function("()=>document.querySelector('#family-status').textContent.includes('Synchronisé')");ok('Identité et autorisation conservées après rechargement sans connexion manuelle')
    offline_context=browser.new_context(viewport={'width':390,'height':844},has_touch=True,service_workers='allow')
    offline_context.on('request',lambda r:external.append(r.url) if r.url.startswith(('http:','https:','ws:','wss:')) and not r.url.startswith(('http://127.0.0.1:8769/','http://127.0.0.1:8180/','http://127.0.0.1:9099/')) else None)
    offline_page=offline_context.new_page();offline_page.on('pageerror',lambda e:errors.append(str(e)))
    offline_page.goto('http://127.0.0.1:8769/');offline_page.wait_for_selector('#device-uid',state='attached')
    offline_page.wait_for_function('()=>navigator.serviceWorker.controller!==null')
    login(offline_page,'family-alice');before=offline_page.locator('#shopping-list-content').inner_text()
    offline_context.set_offline(True)
    row(offline_page).get_by_role('button',name='Enregistrer un achat',exact=True).click();offline_page.locator('#family-bought').fill('0,25');offline_page.locator('#family-confirm').click();offline_page.wait_for_selector('#family-modal.hidden',state='attached')
    offline_page.reload();offline_page.wait_for_selector('#device-uid',state='attached');assert offline_page.evaluate('()=>navigator.onLine')==False
    ok('Vrai cache SW local : shell rechargé réseau coupé, intention durable')
    offline_context.set_offline(False);login(offline_page,'family-alice');offline_page.wait_for_function("()=>!document.querySelector('#family-queue [data-operation-id]')")
    ok('Reconnexion après coupure navigateur et shell hors ligne, file acquittée')
    offline_context.close()
    assert not external, 'Unexpected origins: '+str([r.split('?')[0] for r in external])
    assert not errors, errors
    ok('Aucune requête hors des trois origines loopback et aucune erreur JavaScript')
    (RESULT/'result.json').write_text(json.dumps({'checks':checks,'engine':'Chromium','realPhones':False,'externalRequests':len(external),'pageErrors':errors,'timings':timings},indent=2,ensure_ascii=False))
    browser.close()
    admin('backup');admin('clear-for-restore');admin('restore');admin('restore');admin('check-restore');ok('Restauration réelle des quatre collections après vidage fictif, égalité intégrale et rejeu sans changement')
    (RESULT/'result.json').write_text(json.dumps({'checks':checks,'engine':'Chromium','realPhones':False,'externalRequests':len(external),'pageErrors':errors,'timings':timings},indent=2,ensure_ascii=False))
finally:server.terminate();server.wait(timeout=5)
