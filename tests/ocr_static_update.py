"""Mise à jour consentie, réutilisation du cache et intégrité d'un fragment."""
from pathlib import Path
from http.server import ThreadingHTTPServer
from playwright.sync_api import sync_playwright
import argparse,json,threading,sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(ROOT/'tests'))
from serve_ocr_site import handler_for
from ocr_browser import sample

def run(first,second):
    state={'directory':first};requests=[]
    def handle(*args,**kwargs):return handler_for(state['directory'],lambda m,p:requests.append((m,p)))(*args,**kwargs)
    server=ThreadingHTTPServer(('127.0.0.1',0),handle)
    threading.Thread(target=server.serve_forever,daemon=True).start();origin=f'http://127.0.0.1:{server.server_port}'
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context();page=context.new_page()
        page.goto(origin+'/');page.wait_for_function('() => navigator.serviceWorker.controller!==null')
        page.locator('#offline').click();page.wait_for_function("() => document.getElementById('offline-status').textContent.includes('Cache complet :')",timeout=240000)
        page.locator('#manual').fill('Brouillon fictif à conserver');page.locator('#add-manual').click()
        state['directory']=second
        page.locator('#check-update').click();page.wait_for_function("() => !document.getElementById('apply-update').disabled",timeout=60000)
        assert page.locator('#review section').count()==1
        page.locator('#apply-update').click()
        assert page.locator('#review section').count()==1
        page.locator('#discard-confirm').check();page.locator('#apply-update').click()
        version=next((Path(second)/'releases').iterdir()).name
        page.wait_for_function("v => document.getElementById('version')?.textContent.includes(v)",arg=version,timeout=60000)
        assert page.locator('#review section').count()==0
        before=len(requests)
        page.locator('#photo').set_input_files({'name':'fictif.png','mimeType':'image/png','buffer':sample()})
        page.wait_for_function("() => !document.getElementById('recognize').disabled")
        page.locator('#engine').select_option('trocr');page.locator('#recognize').click()
        page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=180000)
        assert json.loads(page.locator('#metrics').text_content())['runs'][-1]['status']=='ok'
        assert not any(any(x in path for x in ['.wasm','.traineddata','.part-']) for _,path in requests[before:]),'Modèles retéléchargés malgré empreintes identiques'
        manifest=json.loads((Path(second)/'releases'/version/'resources.json').read_text(encoding='utf-8'))
        virtual=next(iter(manifest['virtualFiles'].values()));part=virtual['parts'][0]
        sha=next(f['sha256'] for f in manifest['files'] if f['path']==part)
        page.evaluate("async x=>{const c=await caches.open('inventaire-ocr-https:models');await c.put(location.origin+'/__ocr_model_cache__/'+x,new Response('fragment fictivement altéré'));}",sha)
        page.locator('#recognize').click();page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=180000)
        result=json.loads(page.locator('#metrics').text_content())['runs'][-1]
        assert result['status']=='error'
        assert page.locator('#review section').count()==0
        page.locator('#manual').fill('2 L lait');page.locator('#add-manual').click()
        assert page.locator('#review section').count()==1,'Mode assisté indisponible après erreur d’intégrité'
        # Un téléchargement volontaire suivant vérifie et répare le fragment.
        page.locator('#offline').click()
        page.wait_for_function("() => document.getElementById('offline-status').textContent.includes('Cache complet :')",timeout=240000)
        page.locator('#recognize').click();page.wait_for_function("() => document.getElementById('progress').textContent.includes('Essai terminé')",timeout=180000)
        assert json.loads(page.locator('#metrics').text_content())['runs'][-1]['status']=='ok'
        browser.close()
    server.shutdown();print('PASS : mise à jour consentie, brouillon conservé avant accord, modèles réutilisés, fragment altéré refusé puis réparé, repli assisté')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('first');parser.add_argument('second');args=parser.parse_args();run(args.first,args.second)
