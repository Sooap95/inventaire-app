"""Résolution explicite des liens supprimés, inventaire fictif uniquement."""
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect
import sys,threading,importlib.util,json
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from serve_shopping_lab import Handler
spec=importlib.util.spec_from_file_location('ab',ROOT/'tests/shopping-browser.py');ab=importlib.util.module_from_spec(spec);spec.loader.exec_module(ab)
def run():
 server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
 origin=f'http://127.0.0.1:{server.server_port}';external=[];errors=[]
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  for lang in ['fr','de']:
   ctx=browser.new_context(viewport={'width':393,'height':852},has_touch=True)
   ctx.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else (external.append(r.request.url),r.abort()))
   page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);ab.enter(page)
   ab.start(page,'lait x3');page.locator('#sm-preview input[value=add_extra]').check();ab.validate(page)
   old=ab.getstate(page)['lines'][0]['contributions'][0]['id']
   page.evaluate("products=products.filter(p=>p.id!=='fake-lait');renderCurrent()")
   before=page.evaluate('manualShoppingHost.products()');page.evaluate(f"setLang('{lang}')")
   row=page.locator('#shopping-list-content [data-line-id="product:fake-lait"]')
   expect(row.locator('.sm-amount')).to_have_text('5 L');expect(row.locator('.sm-line-head input')).to_be_disabled()
   resolve='Résoudre l’association' if lang=='fr' else 'Zuordnung klären'
   row.get_by_role('button',name=resolve,exact=True).click()
   expect(page.locator('#sm-modal')).to_be_visible()
   expect(page.locator('#sm-validate')).to_be_disabled();assert page.locator('#sm-preview select').input_value()=='__missing__'
   name=page.locator('#sm-preview [data-field=name]');name.fill('Beurre');name.dispatch_event('change')
   assert page.locator('#sm-preview select').input_value()=='__missing__';expect(page.locator('#sm-validate')).to_be_disabled()
   page.locator('#sm-preview select').select_option('');ab.validate(page)
   state=ab.getstate(page);active=[c for l in state['lines'] for c in l['contributions'] if c['active']]
   assert len(active)==1 and active[0]['id']==old and active[0]['revision']==2
   assert page.evaluate('manualShoppingHost.products()')==before
   assert page.locator('#shopping-list-content [data-product-id=fake-lait]').count()==0
   assert any(l['productId'] is None for l in state['lines'])
   ctx.close()
  assert not external,external;assert not errors,errors;browser.close()
 server.shutdown();out=ROOT/'test-results';out.mkdir(exist_ok=True)
 (out/'phase3-pre-browser.json').write_text(json.dumps({'browser':'Chromium Linux','realPhonesTested':False,'externalRequests':0,'checks':['orphan-explicit-association','no-name-auto-resolution','free-contribution-stable-id','FR-DE','no-product-write']},indent=2))
 print('PASS pré3 : résolution explicite FR/DE, identifiants conservés, aucun réseau externe ni écriture produit')
if __name__=='__main__':run()
