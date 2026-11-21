"""Recette C : Chromium/IndexedDB réels, inventaire fictif, aucun SDK distant."""
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright, expect
import sys, threading, json, importlib.util

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from serve_shopping_lab import Handler

# Réutiliser les gestes de la recette A/B sans modifier ses assertions.
spec = importlib.util.spec_from_file_location('shopping_ab', ROOT / 'tests/shopping-browser.py')
ab = importlib.util.module_from_spec(spec); spec.loader.exec_module(ab)
enter, start, validate, getstate = ab.enter, ab.start, ab.validate, ab.getstate

def choose_file(page, data):
    page.locator('#sm-restore').click()
    page.locator('#sm-restore-file').set_input_files({'name': 'courses-fictives.json', 'mimeType': 'application/json', 'buffer': data})
    expect(page.locator('#sm-restore-preview')).not_to_be_empty()

def export(page):
    with page.expect_download() as download: page.locator('#sm-export').click()
    return Path(download.value.path()).read_bytes()

def install_output_probes(page):
    page.evaluate("""() => {
      Object.defineProperty(navigator, 'clipboard', {configurable:true, value:{writeText:async text=>{window.copiedText=text;}}});
      window.print=()=>{window.printCount=(window.printCount||0)+1;window.dispatchEvent(new Event('beforeprint'));};
    }""")

def outputs(page, expected, warning=None):
    page.locator('[onclick="copyShopping()"]').click()
    page.wait_for_function('typeof window.copiedText === "string"')
    copied = page.evaluate('window.copiedText')
    page.locator('[onclick="printShopping()"]').click()
    printed = page.locator('#print-area .sm-print-item').all_text_contents()
    for text in expected:
        assert text in copied, (text, copied)
        assert any(text in row for row in printed), (text, printed)
    assert len(printed) == len(expected)
    if warning:
        assert warning in copied; assert warning in page.locator('#print-area').text_content()
    assert page.evaluate('window.printCount') > 0

def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    external, requests, errors = [], [], []
    out = ROOT / 'test-results'; out.mkdir(exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        def context():
            ctx = browser.new_context(viewport={'width':393, 'height':852}, has_touch=True, accept_downloads=True)
            def route(r):
                requests.append((r.request.method, r.request.url))
                if r.request.url.startswith(origin + '/'): r.continue_()
                else: external.append(r.request.url); r.abort()
            ctx.route('**/*', route)
            ctx.on('page', lambda page: page.on('pageerror', lambda e: errors.append(str(e))))
            return ctx
        source_ctx = context(); source = source_ctx.new_page(); source.goto(origin + '/'); enter(source)
        original_products = source.evaluate('manualShoppingHost.products()')
        raw_products = source.evaluate("localStorage.getItem('inventaire-maison-v1')")
        install_output_probes(source)
        outputs(source, ['Lait ×2 L'])
        start(source, 'lait x3'); source.locator('#sm-preview input[value=set_total]').check(); validate(source)
        outputs(source, ['Lait ×3 L'])
        start(source, 'brouillon non confirmé'); source.evaluate('copyShopping();buildPrintArea()')
        assert 'brouillon' not in source.evaluate('window.copiedText')
        assert 'brouillon' not in source.locator('#print-area').text_content()
        source.locator('#sm-modal .modal-footer').get_by_role('button', name='Annuler', exact=True).click()
        milk = source.locator('#shopping-list-content [data-product-id=fake-lait]')
        milk.locator('summary').click(); milk.get_by_role('button', name='Retirer cet ajout').click()
        start(source, 'lait x3'); source.locator('#sm-preview input[value=add_extra]').check(); validate(source)
        outputs(source, ['Lait ×5 L'])

        # Une ligne mixte ne peut pas être terminée avec seulement sa part manuelle.
        milk.locator('summary').click()
        manual_check = milk.locator('.sm-contribution input[type=checkbox]')
        main_check = milk.locator('.sm-line-head input')
        auto_check = milk.locator('details>label input')
        manual_check.check()
        expect(main_check).to_have_attribute('aria-checked', 'mixed')
        assert main_check.evaluate('(e)=>e.indeterminate && !e.checked')
        auto_check.check(); expect(main_check).to_be_checked(); assert not main_check.evaluate('(e)=>e.indeterminate')
        main_check.uncheck(); expect(manual_check).not_to_be_checked(); expect(auto_check).not_to_be_checked()
        main_check.check(); expect(manual_check).to_be_checked(); expect(auto_check).to_be_checked()
        manual_check.uncheck(); expect(main_check).to_have_attribute('aria-checked', 'mixed')
        source.reload(); enter(source); install_output_probes(source)
        expect(main_check).to_have_attribute('aria-checked', 'mixed')
        state = getstate(source); line = next(l for l in state['lines'] if l['productId']=='fake-lait')
        assert line['autoCheck']['checked'] and not line['contributions'][0]['checked']

        # Articles libres, caractères spéciaux et conditionnements distincts.
        start(source, 'Äpfel 2,5 kg\n12 œufs\nœufs x2\npain <img src=x onerror=alert(1)>')
        source.locator('#sm-preview .sm-preview-row').nth(1).locator('select').select_option('')
        validate(source)
        expected = ['Lait ×5 L', 'Äpfel ×2.5 kg', 'œufs ×12 œuf', 'Œufs ×2 boîtes', 'pain <img src=x onerror=alert(1)> ×1 article']
        outputs(source, expected)
        assert source.locator('#print-area img,#print-area script').count()==0
        source.locator('#sv-shop-btn').click(); outputs(source, expected); source.locator('#sv-list-btn').click()
        source.evaluate("setLang('de')"); outputs(source, expected)
        assert source.evaluate('window.copiedText').startswith('Einkaufsliste')
        assert 'auto' not in source.locator('[onclick="copyShopping()"]').inner_text().lower()
        # Repli si le presse-papiers est refusé : texte sélectionnable, aucun texte perdu.
        source.evaluate("()=>{navigator.clipboard.writeText=async()=>{throw new Error('denied')};}")
        source.locator('[onclick="copyShopping()"]').click()
        expect(source.locator('.sm-copy-fallback')).to_be_visible()
        assert 'Äpfel ×2.5 kg' in source.locator('.sm-copy-fallback').input_value()
        source.evaluate('()=>{navigator.clipboard.writeText=async text=>{window.copiedText=text;};}')

        # Un total fixé devient périmé après un changement de stock fictif.
        start(source, 'lait x3'); source.locator('#sm-preview input[value=set_total]').check(); validate(source)
        data = export(source)
        source.evaluate("products.find(p=>p.id==='fake-lait').stock=0;renderCurrent()")
        expect(main_check).to_be_disabled()
        outputs(source, [v.replace('Lait ×5', 'Lait ×3') for v in expected], 'Menge erneut prüfen')
        source.emulate_media(media='print'); source.evaluate("window.dispatchEvent(new Event('beforeprint'))")
        expect(source.locator('#print-area')).to_be_visible()
        source.pdf(path=str(out / 'shopping-c-print.pdf'), format='A4', print_background=True)
        assert (out / 'shopping-c-print.pdf').read_bytes().startswith(b'%PDF')
        source.emulate_media(media='screen')
        assert source.evaluate("localStorage.getItem('inventaire-maison-v1')")==raw_products
        assert source.evaluate('manualShoppingHost.products()')==[{**v, 'stock':0} if v['id']=='fake-lait' else v for v in original_products]

        # Autre profil : récupération du vrai export dans un panier contenant déjà du riz.
        target_ctx = context(); target = target_ctx.new_page(); target.goto(origin + '/'); enter(target)
        start(target, 'riz'); validate(target)
        target.evaluate("products.find(p=>p.id==='fake-lait').stock=0;renderCurrent()")
        target_products = target.evaluate('manualShoppingHost.products()')
        before = getstate(target); choose_file(target, data)
        confirm = target.locator('#sm-restore-confirm'); ack = target.locator('#sm-restore-ack')
        expect(confirm).to_be_disabled(); expect(ack).not_to_be_checked()
        expect(target.locator('#sm-restore-preview')).to_contain_text('Quantité à revérifier')
        assert getstate(target)==before  # L'aperçu n'écrit rien.
        for width in [320,375,393,430,768]:
            target.set_viewport_size({'width':width,'height':852})
            assert target.evaluate('document.documentElement.scrollWidth<=innerWidth')
            assert target.locator('#sm-restore-confirm').evaluate('(e)=>e.getBoundingClientRect().height')>=44
        target.set_viewport_size({'width':393,'height':852})
        target.screenshot(path=str(out / 'shopping-c-restore-mobile.png'), full_page=True)

        # Deux aperçus du même fichier : le second est invalidé et peut réévaluer.
        second = target_ctx.new_page(); second.goto(origin + '/'); enter(second); choose_file(second, data)
        ack.check(); confirm.click(); expect(target.locator('#sm-restore-modal')).to_be_hidden()
        expect(second.locator('#sm-restore-error')).to_contain_text('autre onglet')
        expect(second.locator('#sm-restore-confirm')).to_be_disabled()
        assert second.locator('#sm-restore-file').input_value().endswith('courses-fictives.json')
        second.locator('#sm-restore-reevaluate').click()
        expect(second.locator('#sm-restore-preview')).to_contain_text('Aucune nouvelle donnée')
        expect(second.locator('#sm-restore-confirm')).to_be_disabled(); second.close()
        saved = getstate(target)
        assert saved['lines'][0]==before['lines'][0]
        restored = json.loads(data)['state']
        for line in restored['lines']: assert line in saved['lines']
        assert all(op in saved['operations'] for op in before['operations']+restored['operations'])
        assert target.evaluate('manualShoppingHost.products()')==target_products
        assert target.evaluate("localStorage.getItem('inventaire-maison-v1')")==raw_products
        choose_file(target, data); expect(target.locator('#sm-restore-preview')).to_contain_text('Aucune nouvelle donnée')
        expect(confirm).to_be_disabled(); target.locator('#sm-restore-modal .modal-footer button').first.click()
        assert getstate(target)==saved

        # Concurrence sans BroadcastChannel : le CAS de la transaction doit suffire.
        start(source, 'café'); validate(source); newer_data = export(source)
        choose_file(target, newer_data); ack.check()
        target.evaluate("""async()=>{const d=await import('/src/shopping/domain.js'),m=await import('/src/shopping/store.js');const s=await m.indexedStore(),v=await s.read();const n=d.planBatch(v,manualShoppingHost.products(),d.parseList('haricots')).next;await s.commit(v.revision,crypto.randomUUID(),'other-tab',n);s.close();}""")
        confirm.click(); expect(target.locator('#sm-restore-error')).to_contain_text('autre onglet')
        assert not any(l['name']=='café' for l in getstate(target)['lines'])
        target.locator('#sm-restore-reevaluate').click(); expect(ack).not_to_be_checked(); ack.check(); confirm.click()
        expect(target.locator('#sm-restore-modal')).to_be_hidden()
        assert {'café','haricots','riz'}.issubset({l['name'] for l in getstate(target)['lines']})

        # Mauvais fichiers et conflit valide : aucune modification, même partielle.
        preserved = getstate(target)
        for bad in [b'{', json.dumps({**json.loads(data), 'version':9}).encode()]:
            target.locator('#sm-restore').click(); target.locator('#sm-restore-file').set_input_files({'name':'invalide.json','mimeType':'application/json','buffer':bad})
            expect(target.locator('#sm-restore-error')).not_to_be_empty(); expect(confirm).to_be_disabled()
            target.locator('#sm-restore-modal .modal-footer button').first.click(); assert getstate(target)==preserved
        conflicting = json.loads(data)
        conflicting['state']['lines'][0]['contributions'][0]['checked']=not conflicting['state']['lines'][0]['contributions'][0]['checked']
        choose_file(target, json.dumps(conflicting).encode())
        expect(target.locator('#sm-restore-preview')).to_contain_text('Conflit')
        expect(confirm).to_be_disabled(); assert getstate(target)==preserved
        target.locator('#sm-restore-modal .modal-footer button').first.click()

        # FR/DE de l'import et paysage, avec un nouveau profil sans collision.
        de_ctx = context(); de = de_ctx.new_page(); de.goto(origin+'/'); enter(de); de.evaluate("setLang('de')")
        choose_file(de, data); expect(de.locator('#sm-restore-title')).to_have_text('Lokale Einträge wiederherstellen')
        for width,height in [(320,852),(852,393)]:
            de.set_viewport_size({'width':width,'height':height}); assert de.evaluate('document.documentElement.scrollWidth<=innerWidth')
        de.locator('#sm-restore-ack').check(); de.locator('#sm-restore-confirm').click()
        expect(de.locator('#sm-restore-modal')).to_be_hidden()
        install_output_probes(de); outputs(de, [v.replace('Lait ×5', 'Lait ×3') for v in expected])
        assert de.evaluate('manualShoppingHost.products()')==original_products
        assert not external, external; assert not errors, errors
        assert all(method in ['GET','HEAD'] and url.startswith(origin+'/') for method,url in requests)
        (out / 'shopping-c-browser.json').write_text(json.dumps({'browser':'Chromium Linux','realPhonesTested':False,
            'externalRequests':len(external),'checks':['copy-print-2-3-5','visible-list-and-suggestions','FR-DE',
            'free-items-and-units','safe-print-text','mixed-three-state-checks','per-contribution-persistence',
            'clipboard-fallback','stale-total-warning','print-PDF','restore-preview-no-write','restore-atomic',
            'restore-idempotent','restore-preserve-local-and-history','restore-two-tabs',
            'restore-IDB-CAS-without-broadcast','restore-reject-invalid-and-conflicting',
            'restore-mobile-widths','no-stock-write']},indent=2),encoding='utf-8')
        browser.close()
    server.shutdown()
    print('PASS C : copie/impression unifiées, coches mixtes, restauration atomique, FR/DE, aucune requête externe ni écriture de stock')

if __name__=='__main__': run()
