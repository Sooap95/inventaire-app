"""Vraie IndexedDB et DOM Chromium, fixtures isolées, aucun SDK/service externe."""
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright,expect
import sys,threading,json

ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from serve_shopping_lab import Handler

def enter(page):
    page.locator('[data-tab="shopping"]').click()
    page.wait_for_function("() => document.getElementById('sm-add') && !document.getElementById('sm-add').disabled")
def start(page,text):
    page.locator('#sm-add').click();expect(page.locator('#sm-text')).to_be_visible()
    page.locator('#sm-text').fill(text);page.locator('#sm-prepare').click()
def validate(page):
    page.locator('#sm-validate').click();expect(page.locator('#sm-modal')).to_be_hidden()
def getstate(page):
    return page.evaluate("async()=>{const m=await import('/src/shopping/store.js');const s=await m.indexedStore();const v=await s.read();s.close();return v;}")
def run():
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler);threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}';external=[];errors=[];requests=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':393,'height':852},has_touch=True,accept_downloads=True)
        def route(r):
            requests.append((r.request.method,r.request.url))
            if r.request.url.startswith(origin+'/'):r.continue_()
            else:external.append(r.request.url);r.abort()
        context.route('**/*',route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(origin+'/');enter(page)
        before=page.evaluate('manualShoppingHost.products()');raw=page.evaluate("localStorage.getItem('inventaire-maison-v1')")
        start(page,'lait x3')
        radios=page.locator('#sm-preview input[type=radio]');assert radios.count()==3
        assert page.locator('#sm-preview input[data-field=quantity]').evaluate('(e)=>getComputedStyle(e).fontSize')=='16px'
        assert page.locator('#sm-validate').evaluate('(e)=>e.getBoundingClientRect().height')>=44
        assert not page.evaluate('document.getElementById("sm-modal").scrollWidth>innerWidth')
        out=ROOT/'test-results';out.mkdir(exist_ok=True)
        page.screenshot(path=str(out/'shopping-preview-mobile.png'),full_page=True)
        assert not any(radios.nth(i).is_checked() for i in range(3));assert page.locator('#sm-validate').is_disabled()
        page.locator('#sm-preview input[value=keep]').check();validate(page)
        assert not any(c['active'] for l in getstate(page)['lines'] for c in l['contributions'])
        start(page,'lait x3');page.locator('#sm-preview input[value=set_total]').check();validate(page)
        lait=page.locator('#shopping-list-content [data-product-id=fake-lait]')
        expect(lait.locator('.sm-amount')).to_have_text('3 L');assert 'Automatique : 2 L' in lait.inner_text()
        lait.locator('summary').click();lait.get_by_role('button',name='Retirer cet ajout').click()
        page.wait_for_function("() => !document.querySelector('#shopping-list-content .sm-cart')")
        assert '×2 L' in page.locator('#shopping-list-content').inner_text()
        start(page,'lait x3');page.locator('#sm-preview input[value=add_extra]').check();validate(page)
        expect(lait.locator('.sm-amount')).to_have_text('5 L')
        assert lait.evaluate('(e)=>getComputedStyle(e).display')=='block'
        assert lait.locator('.sm-line-head input').evaluate('(e)=>e.getBoundingClientRect().width')>=24
        page.screenshot(path=str(out/'shopping-list-mobile.png'),full_page=True)
        text='pommes\nAtamil x1\n12 œufs\nœufs x2'
        start(page,text)
        rows=page.locator('#sm-preview .sm-preview-row')
        assert rows.nth(1).locator('[data-field=name]').input_value()=='Atamil'
        assert rows.nth(1).locator('[data-field=productId]').input_value()==''
        rows.nth(1).get_by_role('button',name='Proposition : Aptamil',exact=False).click()
        rows.nth(1).locator('input[type=checkbox]').check()
        rows.nth(2).locator('select').select_option('')
        expect(page.locator('#sm-validate')).to_be_enabled()
        # Deux clics programmatiques dans le même tour : une seule validation.
        page.locator('#sm-validate').evaluate('(b)=>{b.click();b.click();}')
        expect(page.locator('#sm-modal')).to_be_hidden()
        state=getstate(page)
        assert len([c for l in state['lines'] for c in l['contributions'] if c['active']])==5
        assert any(a['name']=='atamil' and a['productId']=='fake-aptamil' for a in state['aliases'])
        individual=next(l for l in state['lines'] if l['id'].startswith('free:oeufs'))
        assert individual['unit']=='œuf' and individual['contributions'][-1]['quantity']=='12'
        assert next(l for l in state['lines'] if l['id']=='product:fake-oeufs')['unit']=='boîtes'
        assert page.evaluate('manualShoppingHost.products()')==before
        assert page.evaluate("localStorage.getItem('inventaire-maison-v1')")==raw
        start(page,text);assert 'déjà été validée' in page.locator('#sm-preview').inner_text();assert page.locator('#sm-validate').is_disabled()
        page.locator('#sm-modal .modal-footer').get_by_role('button',name='Annuler',exact=True).click()
        pommes=page.locator('#shopping-list-content [data-line-id="free:pommes"]')
        old=pommes.locator('.sm-line-head input').element_handle();pommes.locator('.sm-line-head input').check()
        page.wait_for_function('(e)=>!e.isConnected',arg=old)
        page.reload();enter(page);expect(pommes.locator('.sm-line-head input')).to_be_checked()
        pommes.locator('summary').click();pommes.get_by_role('button',name='Modifier',exact=True).click()
        field=page.locator('#sm-preview [data-field=quantity]');field.fill('2');field.dispatch_event('change')
        field=page.locator('#sm-preview [data-field=unit]');field.fill('kg');field.dispatch_event('change')
        validate(page);expect(pommes.locator('.sm-amount')).to_have_text('2 kg')
        # Mode courses : un ajout manuel ne reçoit jamais l'action historique Acheté.
        page.locator('#sv-shop-btn').click()
        assert page.locator('#shopping-mode-content [data-line-id="free:pommes"]').get_by_role('button',name='Acheté',exact=False).count()==0
        assert page.locator('#shopping-mode-content [data-product-id=fake-lait]').get_by_role('button',name='Acheté',exact=False).count()==0
        page.locator('#sv-list-btn').click()
        for width in [320,375,393,430,768]:
            page.set_viewport_size({'width':width,'height':852});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.set_viewport_size({'width':852,'height':393});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        # Deux aperçus concurrents : le second reste présent, sa validation est bloquée.
        second=context.new_page();second.on('pageerror',lambda e:errors.append(str(e)));second.goto(origin+'/');enter(second)
        start(page,'pain');start(second,'riz');validate(page)
        expect(second.locator('#sm-validate')).to_be_disabled();assert 'autre onglet' in second.locator('#sm-error').inner_text()
        assert second.locator('#sm-preview [data-field=name]').input_value()=='riz'
        second.locator('#sm-reevaluate').click();expect(second.locator('#sm-validate')).to_be_enabled();validate(second)
        assert {'free:pain','free:riz'}.issubset({l['id'] for l in getstate(second)['lines']})
        # Atomicité réelle de l'adaptateur IndexedDB, au-delà de BroadcastChannel.
        race=second.evaluate("""async()=>{const d=await import('/src/shopping/domain.js'),m=await import('/src/shopping/store.js');const a=await m.indexedStore(),b=await m.indexedStore(),s=await a.read(),p=manualShoppingHost.products();const x=d.planBatch(s,p,d.parseList('poires',p)).next,y=d.planBatch(s,p,d.parseList('prunes',p)).next;const r=await Promise.allSettled([a.commit(s.revision,'race-a','a',x),b.commit(s.revision,'race-b','b',y)]);a.close();b.close();return r.map(v=>({status:v.status,code:v.reason?.code}));}""")
        assert len([v for v in race if v['status']=='fulfilled'])==1
        assert next(v for v in race if v['status']=='rejected')['code']=='conflict'
        second.close();page.reload();enter(page)
        # Stock fictif modifié après un choix de total : signalement, pas de recalcul silencieux.
        start(page,'lait x3');page.locator('#sm-preview input[value=set_total]').check();validate(page)
        page.evaluate("products.find(p=>p.id==='fake-lait').stock=0;renderCurrent()")
        expect(lait).to_contain_text('Quantité à revérifier');expect(lait.locator('.sm-amount')).to_have_text('3 L')
        start(page,'lait x1');assert page.locator('#sm-validate').is_disabled();page.locator('#sm-modal .modal-footer').get_by_role('button',name='Annuler',exact=True).click()
        lait.get_by_role('button',name='Revoir le total').click();page.locator('#sm-review-total').fill('4');validate(page)
        expect(lait.locator('.sm-amount')).to_have_text('4 L');assert 'Quantité à revérifier' not in lait.inner_text()
        # FR/DE : libellés, décimale et ajout libre ; aucun média nécessaire.
        page.evaluate("setLang('de')");expect(page.locator('#sm-add')).to_have_text('Artikel hinzufügen')
        start(page,'Milch 2,5 L');validate(page)
        assert any(l['name']=='Milch' for l in getstate(page)['lines'])
        assert page.evaluate('manualShoppingHost.products()')==[{**v,'stock':0} if v['id']=='fake-lait' else v for v in before]
        # Page déjà chargée : ajout sans réseau, persistance après retour puis rechargement.
        count_before=len(requests);context.set_offline(True)
        start(page,'Brot');validate(page)
        assert any(l['name']=='Brot' for l in getstate(page)['lines']);assert len(requests)==count_before
        context.set_offline(False);page.reload();enter(page)
        assert any(l['name']=='Brot' for l in getstate(page)['lines'])
        assert page.evaluate('manualShoppingHost.products()')==before
        with page.expect_download() as download:page.locator('#sm-export').click()
        exported=json.loads(Path(download.value.path()).read_text(encoding='utf-8'));assert exported['version']==1
        assert len(exported['state']['lines'])>=7
        assert not external,external
        assert not errors,errors
        assert all(method in ['GET','HEAD'] and url.startswith(origin+'/') for method,url in requests)
        out=ROOT/'test-results';out.mkdir(exist_ok=True);(out/'shopping-browser.json').write_text(json.dumps({'browser':'Chromium Linux','realPhonesTested':False,'externalRequests':0,'checks':['2-3-5','eggs-boxes-individual','free-items','typo-alias','no-product-write','double-validation','persistent-check','edit-unit','two-tabs-conflict','IndexedDB-CAS','stale-total','FR-DE','mobile-widths','touch-targets','offline-already-loaded','local-export']},indent=2),encoding='utf-8')
        browser.close()
    server.shutdown();print('PASS : Courses manuelles, vraie IndexedDB locale, doublons, conflits, FR/DE, aucune écriture inventaire ni réseau externe')

if __name__=='__main__':run()
