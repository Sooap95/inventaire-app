"""Recette Art déco en Chromium : UI réelle, données/autorisation explicitement simulées."""
from pathlib import Path
from http.server import ThreadingHTTPServer
import sys, threading, subprocess, json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from serve_mobile_ui import Handler
OUT=ROOT/'test-results/phase7';OUT.mkdir(parents=True,exist_ok=True)
subprocess.run(['python3','scripts/build_mobile_ui.py'],cwd=ROOT,check=True)
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
threading.Thread(target=server.serve_forever,daemon=True).start()
origin=f'http://127.0.0.1:{server.server_port}'
checks=[];outside=[];errors=[];measures=[]
def ok(name):checks.append(name);print('PASS '+name,flush=True)
def no_overflow(page):
 assert page.evaluate('()=>document.documentElement.scrollWidth<=innerWidth+1'),page.evaluate('()=>({width:innerWidth,scroll:document.documentElement.scrollWidth})')
def shot(page,name):
 page.wait_for_timeout(180)
 no_overflow(page)
 page.screenshot(path=str(OUT/(name+'.png')),full_page=True)
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  ctx=browser.new_context(viewport={'width':393,'height':852},has_touch=True,service_workers='allow')
  ctx.on('request',lambda r:outside.append(r.url.split('?')[0]) if r.url.startswith(('http:','https:','ws:','wss:')) and not r.url.startswith(origin+'/') else None)
  p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)));p.goto(origin)
  p.wait_for_function("()=>document.querySelector('#family-status')?.textContent.includes('attend')")
  assert p.locator('#device-uid').is_visible()
  assert p.locator('header [onclick="openAddModal()"]').is_disabled()
  assert p.locator('.product-card').count()==0
  shot(p,'waiting-fr-393')
  p.locator('#simulation-status').select_option('active')
  p.wait_for_function('()=>document.querySelectorAll(".product-card").length===4')
  assert not p.locator('#simulation-controls').evaluate('n=>n.open')
  assert not p.locator('#family-tools').evaluate('n=>n.open')
  assert p.locator('#simulation-controls>summary').is_visible()
  assert 'SIMULÉE' in p.locator('#simulation-controls>summary').inner_text()
  ok('Attente visible et sans action produit ; après autorisation, outils repliés et avertissement fictif permanent')
  # Préparer des courses : doublon 2+3 explicite, article libre, aucun produit créé.
  p.locator('[data-tab=shopping]').tap();p.locator('#family-add').click()
  p.locator('#family-text').fill('lait x3\nbananes 0,5 kg')
  p.locator('#family-prepare').click();p.wait_for_selector('.family-preview input[value=add_extra]')
  assert p.locator('#family-modal input[type=radio]:checked').count()==0
  p.locator('#family-modal input[value=add_extra]').check();p.locator('#family-confirm').click()
  p.wait_for_selector('#family-modal.hidden',state='attached')
  p.wait_for_function("()=>document.querySelector('[data-family-row=product_milk]').textContent.includes('5 L')")
  assert p.evaluate("()=>products.find(p=>p.id==='milk').stock")==1
  assert p.locator('.product-card').count()==4
  for width,height in [(320,844),(375,812),(393,852),(428,926),(768,1024),(1440,1000)]:
   p.set_viewport_size({'width':width,'height':height})
   for lang in ['fr','de']:
    p.evaluate('(lang)=>setLang(lang)',lang)
    p.locator('[data-tab=inventory]').tap()
    assert p.locator('.bottom-tabs button').count()==4
    assert p.locator('.bottom-tabs [aria-current=page]').get_attribute('data-tab')=='inventory'
    assert p.locator('.bottom-tabs').get_attribute('aria-label')==('Navigation principale' if lang=='fr' else 'Hauptnavigation')
    assert p.locator('html').get_attribute('lang')==lang
    assert p.locator('#last-update').inner_text()==('Simulation à jour' if lang=='fr' else 'Simulation aktuell')
    first=p.locator('.product-card').first.bounding_box();nav=p.locator('.bottom-tabs').bounding_box()
    assert first['y']<nav['y'],(width,lang,first,nav)
    for button in p.locator('.product-card').first.locator('.stock-btn').all():
     b=button.bounding_box();assert b['y']+b['height']<=nav['y'],(width,lang,b,nav)
    panels=p.locator('#family-panel').bounding_box()['height']+p.locator('#simulation-panel').bounding_box()['height']
    assert panels<190,(width,lang,panels)
    for button in p.locator('.bottom-tabs button:visible, .stock-btn:visible, .header-add:visible').all():
     b=button.bounding_box();assert b['width']>=44 and b['height']>=44,(button.get_attribute('class'),b)
    assert p.evaluate("()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()").lower()=='#174c3b'
    shot(p,f'stock-{lang}-{width}')
    measures.append({'width':width,'height':height,'lang':lang,'technicalPanelsPx':round(panels,1),'firstProductTopPx':round(first['y'],1),'navigationTopPx':round(nav['y'],1)})
    # Détails réellement ouverts, métadonnées et édition toujours présentes.
    p.locator('.product-card-details summary').first.tap()
    assert p.locator('.product-card-details[open] [data-product-action=edit]').is_visible()
    assert p.locator('.product-card-details[open] [data-product-action=delete]').is_visible()
    selected=p.locator('.product-card').first.get_attribute('data-id')
    p.locator('.product-card-details[open] [data-product-action=history]').tap()
    assert p.locator('#stats-select').input_value()==selected
    assert p.locator('.bottom-tabs [aria-current=page]').get_attribute('data-tab')=='more'
    p.locator('[data-tab=more]').tap();shot(p,f'plus-{lang}-{width}')
    assert p.locator('#tab-more [onclick="openSettings()"]').is_visible()
    assert p.locator('#tab-more [onclick="exportData()"]').is_visible()
    assert p.locator('#tab-more [onclick="triggerImport()"]').is_visible()
    p.locator('#tab-more [onclick="switchTab(\'stats\')"]').click()
    assert p.locator('.bottom-tabs [aria-current=page]').get_attribute('data-tab')=='more'
    assert p.locator('#family-load-stats').is_visible()
    no_overflow(p)
    p.locator('[data-tab=qr]').tap()
    assert p.locator('#tab-qr').is_visible()
    assert p.locator('#app-qr-display').inner_text()==('Code QR indisponible dans cette recette. Aucun service externe activé.' if lang=='fr' else 'QR-Code in diesem Test nicht verfügbar. Keine externen Dienste aktiviert.')
    no_overflow(p)
    p.locator('[data-tab=shopping]').tap();shot(p,f'courses-{lang}-{width}')
    assert p.locator('#family-add').is_visible()
    p.locator('#family-add').tap();p.locator('#family-text').fill('Atamil x1\nœufs\n12 œufs')
    p.locator('#family-prepare').click();p.wait_for_selector('.family-preview')
    shot(p,f'apercu-{lang}-{width}')
    assert p.locator('#family-modal .family-preview').count()==3
    last=p.locator('#family-modal .family-preview').last.locator('input').first
    last.scroll_into_view_if_needed();assert last.is_visible()
    b=last.bounding_box();assert b['y']+b['height']<=p.locator('#family-modal .modal-footer').bounding_box()['y']
    p.locator('#family-modal .modal-footer button').first.click()
   ok(f'{width}px : Stock/Courses/Scanner/Plus, Stats, aperçu, FR/DE, contrôles tactiles et aucun débordement')
  p.evaluate("()=>setLang('fr')");p.locator('[data-tab=more]').tap()
  p.locator('#tab-more [onclick="openSettings()"]').tap();assert p.locator('#settings-modal').is_visible()
  p.locator('#settings-modal .modal-close').tap()
  # Commandes techniques accessibles volontairement ; révocation reste visible.
  p.locator('#family-tools>summary').tap();assert p.locator('#device-copy').is_visible()
  p.locator('#family-tools>summary').tap()
  p.locator('#simulation-controls>summary').tap();p.locator('#simulation-status').select_option('revoked')
  p.wait_for_function('()=>document.querySelectorAll(".product-card").length===0')
  assert p.locator('#family-tools').evaluate('n=>n.open')
  assert p.locator('header [onclick="openAddModal()"]').is_disabled()
  shot(p,'revoked-fr-1440')
  p.locator('#simulation-status').select_option('active')
  p.wait_for_function('()=>document.querySelectorAll(".product-card").length===4')
  p.wait_for_function('()=>navigator.serviceWorker.controller!==null')
  ctx.set_offline(True);p.reload();p.wait_for_function('()=>document.querySelectorAll(".product-card").length===4')
  p.set_viewport_size({'width':375,'height':812});p.locator('[data-tab=inventory]').tap()
  assert p.evaluate("()=>[...document.styleSheets].some(s=>s.href?.endsWith('/src/ui/art-deco.css')&&s.cssRules.length>20)")
  shot(p,'offline-fr-375');ok('Révocation bloquante, accès volontaire aux outils, réouverture hors ligne et CSS Art déco effectivement précaché')
  assert not errors,errors;assert not outside,outside
  (OUT/'art-deco-browser.json').write_text(json.dumps({'checks':checks,'viewports':measures,'screenshots':len(list(OUT.glob('*.png'))),'realPhone':False,'engine':'Chromium','backend':'local IndexedDB simulation; no Firebase','externalRequests':outside,'pageErrors':errors},ensure_ascii=False,indent=2)+'\n')
  browser.close()
finally:server.shutdown();server.server_close()
