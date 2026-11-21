"""Recette du paquet autonome, en-têtes Pages émulés, sans service distant."""
import argparse,json,threading,sys
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(ROOT/'tests'))
from serve_ocr_site import handler_for
from ocr_browser import sample

def run(site,engine='chromium'):
    requests=[];console=[];errors=[]
    server=ThreadingHTTPServer(('127.0.0.1',0),handler_for(site,lambda method,path:requests.append((method,path))))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    origin=f'http://127.0.0.1:{server.server_port}'
    sentinel='PRIVE_TEST_NE_JAMAIS_ENVOYER'
    with sync_playwright() as p:
        browser=(p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']) if engine=='chromium' else p.webkit.launch())
        context=browser.new_context(accept_downloads=True,viewport={'width':430,'height':932},has_touch=True)
        external=[]
        def route(r):
            if r.request.url.startswith(origin+'/'):r.continue_()
            else:external.append(r.request.url);r.abort()
        context.route('**/*',route)
        page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda e:console.append(e.text))
        response=page.goto(origin+'/')
        assert "default-src 'none'" in response.headers['content-security-policy']
        assert response.headers['referrer-policy']=='no-referrer'
        page.wait_for_function("() => document.getElementById('assets').textContent.includes('prêtes')")
        page.wait_for_function("() => navigator.serviceWorker.controller !== null")
        assert not any(any(s in path for s in ['.traineddata','.wasm','.part-']) for _,path in requests),'Poids chargés avant consentement'
        page.locator('#photo').set_input_files({'name':sentinel+'.png','mimeType':'image/png','buffer':sample()})
        page.wait_for_function("() => document.getElementById('photo-canvas').width>0")
        assert page.locator('#recognize').is_disabled()
        page.locator('#manual').fill(sentinel)
        page.locator('#add-manual').click()
        assert page.locator('#review section').count()==1
        # Garde réseau : requêtes interdites refusées avant tout accès serveur.
        for expression in ["fetch('/?'+s)","fetch('/sw.js',{method:'POST',body:s})","fetch('https://example.org/'+s)","Promise.resolve(new XMLHttpRequest())"]:
            blocked=page.evaluate("async s=>{try{await "+expression+";return false;}catch{return true;}}",sentinel)
            assert blocked,expression
        assert page.evaluate('s=>navigator.sendBeacon("/",s)',sentinel) is False
        for width in [320,375,393,430,768]:
            page.set_viewport_size({'width':width,'height':852})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
        page.set_viewport_size({'width':852,'height':393})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
        page.set_viewport_size({'width':430,'height':932})
        page.locator('#offline').click()
        page.wait_for_function("() => document.getElementById('offline-status').textContent.includes('Cache complet :')",timeout=240000)
        assert page.locator('#recognize').is_enabled()
        page.locator('#engine').select_option('both');page.locator('#recognize').click()
        page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=240000)
        online=json.loads(page.locator('#metrics').text_content())
        assert len(online['runs'])==2 and all(r['status']=='ok' for r in online['runs']),page.locator('#status').inner_text()
        # Hors ligne réel après rechargement et nouvelle sélection de fichier.
        page.evaluate("caches.open('temoin-application-voisine').then(c=>c.put('/temoin',new Response('intact')))")
        context.set_offline(True);page.reload()
        page.wait_for_function("() => document.getElementById('assets').textContent.includes('prêtes')")
        page.locator('#photo').set_input_files({'name':sentinel+'.png','mimeType':'image/png','buffer':sample()})
        page.wait_for_function("() => !document.getElementById('recognize').disabled")
        page.locator('#language').select_option('de');page.locator('#engine').select_option('both');page.locator('#recognize').click()
        page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=240000)
        offline=json.loads(page.locator('#metrics').text_content())
        assert len(offline['runs'])==2 and all(r['status']=='ok' for r in offline['runs']),page.locator('#status').inner_text()
        # Le bouton de suppression exige un geste explicite supplémentaire.
        page.locator('#uninstall').click()
        assert 'confirmer' in page.locator('#lifecycle-status').inner_text()
        page.locator('#discard-confirm').check();page.locator('#uninstall').click()
        page.wait_for_function("() => document.getElementById('lifecycle-status').textContent.includes('désinscrit')")
        assert page.evaluate("caches.keys().then(a=>a.filter(k=>k.startsWith('inventaire-ocr-https:')))")==[]
        assert page.evaluate("navigator.serviceWorker.getRegistrations().then(a=>a.length)")==0
        assert page.evaluate("caches.open('temoin-application-voisine').then(c=>c.match('/temoin')).then(r=>r.text())")=='intact'
        assert page.evaluate("document.getElementById('photo-canvas').width")==0
        assert not external,external
        assert not errors,errors
        assert all(method=='GET' and '?' not in path and sentinel not in path for method,path in requests)
        assert all(sentinel not in item for item in console)
        result={'browser':engine,'online':online,'offline':offline,'requestCount':len(requests),'externalRequests':0,'methods':sorted(set(m for m,_ in requests)),
                'checks':['voluntary-download','two-real-engines','chunked-ONNX','offline-reload','FR-DE','no-content-in-requests-or-console','CSP','mobile-widths','uninstall','neighbour-cache-intact']}
        out=ROOT/'test-results';out.mkdir(exist_ok=True);(out/f'ocr-static-{engine}.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
        browser.close()
    server.shutdown();print('PASS : paquet autonome, deux moteurs, hors ligne, confidentialité, désinstallation ('+engine+')')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory');parser.add_argument('--browser',choices=['chromium','webkit'],default='chromium');args=parser.parse_args();run(args.directory,args.browser)
