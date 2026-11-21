"""Niveau 1 statique, fictif, sans Firebase ; aucune publication."""
from pathlib import Path
import re,json,subprocess,hashlib,shutil,argparse
ROOT=Path(__file__).resolve().parents[1];DEST=ROOT/'dist/mobile-ui'
LABEL='phase7-1-quick-stock'
CSP="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'"
def sha(data):return hashlib.sha256(data).hexdigest()
def build(label=LABEL):
    DEST.mkdir(parents=True,exist_ok=True)
    for folder in ['src/family','src/shopping','src/domain','src/ui']:(DEST/folder).mkdir(parents=True,exist_ok=True)
    text=(ROOT/'index.html').read_text()
    text=re.sub(r'<script src="https://[^\"]+"[^>]*></script>','',text)
    text=text.replace('<script type="module" src="src/shopping/manual-ui.js"></script>','')
    text,n=re.subn(r'const firebaseConfig = \{[\s\S]*?\n\};','const firebaseConfig = {apiKey:"NO_FIREBASE_IN_MOBILE_UI"};',text,count=1)
    if n!=1:raise RuntimeError('Configuration historique non assainie')
    text=re.sub(r'href="https://[^\"]+"','aria-disabled="true"',text)
    text=text.replace('<title>Inventaire Maison</title>','<title>Inventaire Maison — TEST FICTIF</title>')
    text=text.replace("doc_title: 'Inventaire Maison'","doc_title: 'Inventaire Maison — TEST FICTIF'").replace("doc_title: 'Hausinventar'","doc_title: 'Hausinventar — FIKTIVER TEST'")
    text=text.replace('content="Inventaire"','content="Inventaire TEST"')
    config=json.dumps({'mode':'ui-fixture','projectId':'ui-fixture-no-firebase','releaseLabel':label},ensure_ascii=True)
    preamble='<script>window.FAMILY_LAB_CONFIG='+config+';localStorage.setItem("app-lang",localStorage.getItem("app-lang")||"fr");localStorage.setItem("user-name","Recette fictive");window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;</script>'
    text=text.replace('<head>','<head>'+preamble+'<link rel="stylesheet" href="mobile.css">',1)
    (DEST/'index.html').write_text(text)
    for file in ['src/family/bootstrap.js','src/family/family.css','src/shopping/manual.css','src/domain/stock.js','src/ui/art-deco.css']:shutil.copyfile(ROOT/file,DEST/file)
    subprocess.run(['node',str(ROOT/'security/scripts/build-mobile-bundle.mjs')],cwd=ROOT,check=True)
    manifest=json.loads((ROOT/'manifest.json').read_text());manifest.update({'id':'./','name':'Inventaire Maison — TEST FICTIF','short_name':'Inventaire TEST','description':'Recette locale simulée : aucune synchronisation Firebase','start_url':'./','scope':'./','theme_color':'#fff8ee'})
    (DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (DEST/'mobile.css').write_text('''.simulation-panel{background:#fff1dc;color:#462400;padding:16px;border:3px solid #9b4c00;line-height:1.5}.simulation-panel>strong{display:block}.simulation-panel button,.simulation-panel select,.simulation-panel a{min-height:44px;padding:10px;margin:5px;font-size:16px;box-sizing:border-box}.simulation-panel a{display:inline-block}.simulation-panel label{display:block}.simulation-panel button{white-space:normal}input,textarea,select{font-size:16px}.family-modal{padding-bottom:env(safe-area-inset-bottom)}.family-modal .modal-footer{flex-wrap:wrap}body{overflow-wrap:anywhere}button,.tab{min-height:44px}.simulation-panel summary{min-height:44px;padding:10px;cursor:pointer}.simulation-panel details>button,.simulation-panel details>a{display:block}@media print{.simulation-panel{display:none!important}}''')
    (DEST/'guide.html').write_text((ROOT/'docs/mobile-guide.html').read_text())
    (DEST/'404.html').write_text('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Recette</title><p>Page absente du paquet de recette. Revenir à <a href="./">la recette fictive</a>.</p></html>')
    headers='/*\n  Content-Security-Policy: '+CSP+'\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Cache-Control: no-cache\n'
    (DEST/'_headers').write_text(headers)
    allowed={'index.html','mobile.css','guide.html','404.html','manifest.json','_headers','release.json','sw.js','bundle-inputs.json','src/family/bootstrap.js','src/family/family.css','src/family/mobile-ui.bundle.js','src/shopping/manual.css','src/domain/stock.js','src/ui/art-deco.css'}
    unknown={str(p.relative_to(DEST)) for p in DEST.rglob('*') if p.is_file()}-allowed
    if unknown:raise RuntimeError('Unexpected files in mobile distribution: '+repr(sorted(unknown)))
    files={str(p.relative_to(DEST)):sha(p.read_bytes()) for p in DEST.rglob('*') if p.is_file() and p.name not in ['sw.js','release.json','_headers']}
    identity=sha(json.dumps({'files':files,'label':label,'workerTemplate':4},sort_keys=True).encode())
    release={'format':'inventaire-mobile-ui-release','version':1,'id':identity,'label':label,'mode':'ui-fixture','realFirebase':False,'firebaseSdk':False,'authorization':'simulation-only','synchronization':'none-between-devices','files':files}
    (DEST/'release.json').write_text(json.dumps(release,indent=2,ensure_ascii=False)+'\n')
    hashes={'./'+p:h for p,h in files.items() if not p.endswith('.html')};hashes['./']=files['index.html'];hashes['./guide']=files['guide.html'];hashes['./release.json']=sha((DEST/'release.json').read_bytes())
    worker="const CACHE='inventaire-mobile-ui-"+identity+"';const ASSETS="+json.dumps(hashes)+";\n"
    worker+='''async function verified(url,expected){const response=await fetch(new Request(url,{cache:'reload'}));if(!response.ok||response.redirected||new URL(response.url).origin!==url.origin)throw Error('shell-response');const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==expected)throw Error('shell-integrity');return response;}
self.addEventListener('install',event=>event.waitUntil((async()=>{const entries=await Promise.all(Object.entries(ASSETS).map(async([file,expected])=>{const url=new URL(file,self.registration.scope);return [url.href,await verified(url,expected)];}));const cache=await caches.open(CACHE);await Promise.all(entries.map(([url,response])=>cache.put(url,response)));})().catch(async error=>{await caches.delete(CACHE);throw error;})));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('inventaire-mobile-ui-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.origin!==location.origin)return;url.search='';url.hash='';for(const [alias,path] of Object.entries({'./index.html':'./','./guide.html':'./guide'}))if(new URL(alias,self.registration.scope).href===url.href)url.href=new URL(path,self.registration.scope).href;const file=Object.keys(ASSETS).find(file=>new URL(file,self.registration.scope).href===url.href);if(!file)return;event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(url.href);if(cached)return cached;const response=await verified(url,ASSETS[file]);await cache.put(url.href,response.clone());return response;}));});
'''
    (DEST/'sw.js').write_text(worker)
    for p in DEST.rglob('*'):
        if p.is_file() and b'inventaire-maison-8fd95' in p.read_bytes():raise RuntimeError('Production reference forbidden in mobile distribution')
    (ROOT/'artifacts').mkdir(exist_ok=True)
    shutil.make_archive(str(ROOT/'artifacts/Inventaire-Maison-Niveau1-mobile'),'zip',DEST)
    print('Distribution fictive non publiée : dist/mobile-ui ; archive artifacts/Inventaire-Maison-Niveau1-mobile.zip')
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--label',default=LABEL);build(parser.parse_args().label)
