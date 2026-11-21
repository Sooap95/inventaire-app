"""Vrais moteurs sur une image imprimée fictive, pas une preuve manuscrite mobile."""
import json, threading, sys, io, time, argparse
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from serve_labs import Handler

def sample(text='2 L lait'):
    image=Image.new('RGB',(560,90),'white')
    font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',40)
    ImageDraw.Draw(image).text((20,15),text,font=font,fill='black')
    output=io.BytesIO();image.save(output,format='PNG')
    return output.getvalue()

def run():
    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    external,errors,methods=[],[],[]
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(accept_downloads=True,viewport={'width':393,'height':852})
        def route(request_route):
            request=request_route.request
            methods.append(request.method)
            if request.url.startswith(origin+'/'):
                request_route.continue_()
            else:
                external.append(request.url);request_route.abort()
        context.route('**/*',route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(origin+'/labs/ocr/')
        page.wait_for_function("() => document.getElementById('assets').textContent.includes('prêtes')")
        # Mode assisté, aucune image ou modèle nécessaire.
        page.locator('#manual').fill('2 L lait\nPommes')
        page.locator('#add-manual').click()
        assert page.locator('#review section').count()==2
        page.locator('#export-confirmed').click()
        assert 'Aucun article confirmé' in page.locator('#review-status').inner_text()
        page.locator('#review section').first.locator('input[type=checkbox]').check()
        with page.expect_download() as pending:
            page.locator('#export-confirmed').click()
        exported=json.loads(Path(pending.value.path()).read_text())
        assert len(exported['entries'])==1 and exported['entries'][0]['quantity']==2
        page.locator('#review section').first.locator('input[type=text]').first.fill('Lait corrigé')
        assert not page.locator('#review section').first.locator('input[type=checkbox]').is_checked()
        page.locator('#clear').click()
        page.locator('#photo').set_input_files({'name':'fictif.png','mimeType':'image/png','buffer':sample()})
        page.wait_for_function("() => !document.getElementById('recognize').disabled")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Débordement horizontal à 393 px'
        page.locator('#engine').select_option('both')
        page.locator('#recognize').click()
        page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=240000)
        metrics=json.loads(page.locator('#metrics').text_content())
        print(json.dumps(metrics,ensure_ascii=False,indent=2),flush=True)
        assert len(metrics['runs'])==2
        assert all(r['status']=='ok' for r in metrics['runs']),page.locator('#status').inner_text()
        texts=page.locator('#results pre').all_inner_texts()
        assert len(texts)==2
        page.locator('#reference').fill('2 L lait')
        page.locator('#measure').click()
        metrics=json.loads(page.locator('#metrics').text_content())
        assert 'results' not in metrics['runs'][0]
        assert all('referenceMetrics' in r for r in metrics['runs'])
        for width in [320,375,393,430,768]:
            page.set_viewport_size({'width':width,'height':852})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Débordement {width}'
        page.set_viewport_size({'width':852,'height':393})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Débordement paysage'
        page.set_viewport_size({'width':393,'height':852})
        results=ROOT/'test-results';results.mkdir(exist_ok=True)
        page.screenshot(path=str(results/'ocr-mobile-layout.png'),full_page=True)
        # Cache vérifié puis rechargement sans réseau : shell et les deux moteurs.
        page.locator('#offline').click()
        page.wait_for_function("() => document.getElementById('offline-status').textContent.includes('Cache complet :')",timeout=180000)
        page.evaluate("caches.open('autre-application-temoin').then(c=>c.put('/temoin',new Response('intact')))")
        context.set_offline(True)
        page.reload()
        page.wait_for_function("() => document.getElementById('assets').textContent.includes('prêtes')")
        page.locator('#photo').set_input_files({'name':'fictif.png','mimeType':'image/png','buffer':sample()})
        page.wait_for_function("() => !document.getElementById('recognize').disabled")
        page.locator('#engine').select_option('both')
        page.locator('#recognize').click()
        page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=240000)
        offline=json.loads(page.locator('#metrics').text_content())
        assert all(r['status']=='ok' for r in offline['runs']),page.locator('#status').inner_text()
        assert page.evaluate("caches.open('autre-application-temoin').then(c=>c.match('/temoin')).then(r=>r.text())")=='intact'
        # La langue allemande utilise bien son modèle local, même hors ligne.
        page.locator('#language').select_option('de')
        page.locator('#engine').select_option('tesseract')
        page.locator('#recognize').click()
        page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=60000)
        german=json.loads(page.locator('#metrics').text_content())['runs'][-1]
        assert german['language']=='de' and german['status']=='ok'
        # Temps complet figé après une correction réellement confirmée.
        page.locator('#manual').fill('2 L lait')
        page.locator('#add-manual').click()
        page.locator('#review input[type=checkbox]').check()
        page.locator('#finish-trial').click()
        frozen=json.loads(page.locator('#metrics').text_content())['finishedPreparationMs']
        assert frozen is not None and frozen>0
        page.locator('#export-metrics').click()
        assert json.loads(page.locator('#metrics').text_content())['finishedPreparationMs']==frozen
        page.locator('#engine').select_option('trocr')
        page.locator('#recognize').click()
        page.locator('#cancel').click()
        assert page.locator('#recognize').is_enabled()
        page.locator('#clear').click()
        assert page.locator('#review section').count()==0
        assert page.evaluate("document.getElementById('photo-canvas').width")==0
        assert not external,external
        assert all(m=='GET' for m in methods),methods
        assert not errors,errors
        (results/'ocr-desktop.json').write_text(json.dumps({'sample':'printed-synthetic-not-handwriting','online':metrics,'offline':offline,'recognizedSyntheticText':texts,'externalRequests':external},ensure_ascii=False,indent=2))
        print('PASS : mode assisté, confirmation, deux vrais moteurs, mesures sans texte, hors ligne, annulation, cache voisin intact, aucun envoi externe',flush=True)
        browser.close()
    server.shutdown()

if __name__=='__main__':run()
