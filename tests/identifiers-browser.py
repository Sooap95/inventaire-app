"""IDs hostiles traités comme données dans l'interface historique, jamais exécutés."""
from pathlib import Path
from http.server import ThreadingHTTPServer
import threading,sys,json
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from serve_shopping_lab import Handler
server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
errors=[];external=[]
try:
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':393,'height':852},has_touch=True)
  page.route('**/*',lambda r:r.continue_() if r.request.url.startswith(origin+'/') else (external.append(r.request.url),r.abort()))
  page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin);page.wait_for_function('()=>window.ManualShopping!==undefined')
  for lang in ['fr','de']:
   for identifier in ["a');globalThis.__idExecuted=true;('b",'q\" autofocus onfocus=globalThis.__idExecuted=true x=\"z','é [a] ` \\ & <id>']:
    page.evaluate('''({identifier,lang})=>{window.__idExecuted=false;window.calls=[];localStorage.setItem("shopping-checked","[]");window.ManualShopping=null;setLang(lang);products=[{id:identifier,name:'Fictif',category:'Alimentation',unit:'L',stock:0,threshold:1,target:2,frequency:'',restockHistory:[]}];adjustStock=(id,d)=>calls.push(['stock',id,d]);openEditModal=id=>calls.push(['edit',id]);deleteProduct=id=>calls.push(['delete',id]);openBuyModal=id=>calls.push(['buy',id]);switchTab('inventory');renderInventory();}''',{'identifier':identifier,'lang':lang})
    card=page.locator('.product-card');assert card.get_attribute('data-id')==identifier;assert card.locator('[onclick]').count()==0
    for action in ['stock','edit','delete']:
     if action=='edit':card.locator('.product-card-details summary').click()
     buttons=card.locator('[data-product-action='+action+']')
     for n in range(buttons.count()):buttons.nth(n).click()
    card.locator('[data-product-action=history]').click();assert page.locator('#stats-select').input_value()==identifier
    calls=page.evaluate('()=>calls');assert all(c[1]==identifier for c in calls);assert len(calls)==4
    page.evaluate("()=>{switchTab('shopping');renderShopping();}");cb=page.locator('#shopping-list-content input[type=checkbox]');cb.check();assert page.evaluate('()=>JSON.parse(localStorage.getItem("shopping-checked"))')[0]==identifier
    html=page.evaluate('()=>renderShopCardsFlat(products,new Set())');assert 'onclick=' not in html
    page.evaluate('html=>{document.getElementById("shopping-list-content").innerHTML=html}',html);page.locator('[data-product-action=buy]').click();assert page.evaluate('()=>calls.at(-1)[1]')==identifier
    page.evaluate('()=>renderStats()');assert page.locator('#stats-select option').first.get_attribute('value')==identifier
    assert not page.evaluate('()=>__idExecuted');assert page.locator('[autofocus],[onfocus]').count()==0
  assert not errors,errors;assert not external
  output=ROOT/'test-results/phase5';output.mkdir(parents=True,exist_ok=True);(output/'identifiers.json').write_text(json.dumps({'fr':True,'de':True,'ids':3,'scriptExecutions':0,'pageErrors':errors,'externalRequests':external},indent=2));print('PASS IDs : FR/DE, guillemets/Unicode, actions exactes, aucune exécution ni requête externe')
  browser.close()
finally:server.shutdown()
