"""Recette navigateur isolée. Aucun chargement de index.html ou de Firebase."""
import json, threading, sys
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from serve_labs import Handler

def run():
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{server.server_port}'
    external, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        context = browser.new_context(accept_downloads=True)
        def route(request_route):
            if request_route.request.url.startswith(origin + '/'):
                request_route.continue_()
            else:
                external.append(request_route.request.url)
                request_route.abort()
        context.route('**/*', route)
        page = context.new_page()
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(origin + '/labs/backup/')
        page.evaluate("localStorage.setItem('inventaire-maison-v1','NE-PAS-TOUCHER')")
        page.locator('#backup-file').set_input_files(str(ROOT/'tests/fixtures/products.json'))
        page.get_by_role('button', name='Confirmer la restauration').wait_for()
        page.wait_for_function("() => !document.getElementById('restore').disabled")
        page.locator('#restore').click()
        assert 'terminée' in page.locator('#status').inner_text()
        assert page.evaluate("localStorage.getItem('inventaire-maison-v1')") == 'NE-PAS-TOUCHER'
        restored = json.loads(page.locator('#sandbox').inner_text())
        assert len(restored) == 2
        page.reload()
        assert len(json.loads(page.locator('#sandbox').inner_text())) == 2
        page.locator('#backup-file').set_input_files(str(ROOT/'tests/fixtures/products.json'))
        page.wait_for_function("() => !document.getElementById('restore').disabled")
        page.locator('#restore').click()
        assert len(json.loads(page.locator('#sandbox').inner_text())) == 2
        conflict = [dict(restored[0],stock=100)]
        page.locator('#backup-file').set_input_files({'name':'conflict.json','mimeType':'application/json','buffer':json.dumps(conflict).encode()})
        page.wait_for_function("() => document.getElementById('preview').textContent.includes('fiction-lait')")
        assert page.locator('#restore').is_disabled()
        assert context.request.get(origin+'/index.html').status == 403
        assert context.request.get(origin+'/sw.js').status == 403
        assert not external, external
        assert not errors, errors
        print('PASS : restauration, persistance, idempotence, conflit, stockage historique intact, réseau externe absent, application et SW inaccessibles')
        browser.close()
    server.shutdown()

if __name__ == '__main__':
    run()
