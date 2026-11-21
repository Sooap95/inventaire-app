"""Le mode assisté reste utilisable sans modèles ou après panne du worker."""
import json, threading, sys
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
sys.path.insert(0,str(ROOT/'tests'))
from serve_labs import Handler
from ocr_browser import sample

def run():
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    errors=[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context()
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        context.route('**/vendor/ocr-manifest.json',lambda r:r.fulfill(status=404,body='absent'))
        page.goto(origin+'/labs/ocr/')
        page.wait_for_function("() => document.getElementById('assets').textContent.includes('absents')")
        page.locator('#photo').set_input_files({'name':'fictif.png','mimeType':'image/png','buffer':sample()})
        page.wait_for_function("() => document.getElementById('photo-canvas').width>0")
        assert page.locator('#recognize').is_disabled()
        assert page.locator('#assist-photo').is_visible()
        page.locator('#manual').fill('2 L lait')
        page.locator('#add-manual').click()
        page.locator('#review input[type=checkbox]').check()
        page.locator('#finish-trial').click()
        assert json.loads(page.locator('#metrics').text_content())['finishedPreparationMs']>0
        context.unroute('**/vendor/ocr-manifest.json')
        page.reload()
        page.wait_for_function("() => document.getElementById('assets').textContent.includes('prêtes')")
        context.route('**/labs/ocr/recognizer.worker.js',lambda r:r.fulfill(status=200,content_type='text/javascript',body="throw new Error('panne simulée');"))
        page.locator('#photo').set_input_files({'name':'fictif.png','mimeType':'image/png','buffer':sample()})
        page.wait_for_function("() => !document.getElementById('recognize').disabled")
        page.locator('#recognize').click()
        page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')")
        assert json.loads(page.locator('#metrics').text_content())['runs'][0]['status']=='error'
        assert page.locator('#recognize').is_enabled()
        page.locator('#manual').fill('2 L lait')
        page.locator('#add-manual').click()
        assert page.locator('#review section').count()==1
        assert not errors,errors
        browser.close()
    server.shutdown()
    print('PASS : modèles absents, panne du worker, photo assistée, correction et chronomètre utilisables')

if __name__=='__main__':run()
