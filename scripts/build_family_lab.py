"""Copie statique de recette, sans configuration réelle ni ressource distante."""
from pathlib import Path
import re,json,shutil,subprocess,os,hashlib
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'dist/family-lab'
def build():
    DEST.mkdir(parents=True,exist_ok=True)
    text=(ROOT/'index.html').read_text()
    text=re.sub(r'<script src="https://[^\"]+"[^>]*></script>','',text)
    text=re.sub(r'const firebaseConfig = \{[\s\S]*?\n\};','const firebaseConfig = {apiKey: "TON_LOCAL_TEST"};',text,count=1)
    preamble='<script>window.FAMILY_LAB_CONFIG={projectId:"demo-inventaire-v02"};localStorage.setItem("app-lang",localStorage.getItem("app-lang")||"fr");localStorage.setItem("user-name","Test fictif");window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;</script>'
    text=text.replace('<head>','<head>'+preamble,1)
    (DEST/'index.html').write_text(text)
    for source in ['src','manifest.json']:
        if (ROOT/source).is_dir():shutil.copytree(ROOT/source,DEST/source,dirs_exist_ok=True)
        else:shutil.copyfile(ROOT/source,DEST/source)
    subprocess.run(['node',str(ROOT/'security/scripts/build-family-bundle.mjs')],cwd=ROOT,check=True)
    # Un seul shell local, aucun cache de requête Firestore ou de journal.
    assets=['./','./index.html','./manifest.json']+['./'+str(p.relative_to(DEST)) for p in (DEST/'src').rglob('*') if p.is_file() and p.suffix in ['.js','.css']]
    fingerprint=hashlib.sha256(json.dumps({p:hashlib.sha256((DEST/p.removeprefix("./")).read_bytes()).hexdigest() for p in assets if p!="./"},sort_keys=True).encode()).hexdigest()
    worker="const CACHE='inventaire-family-lab-"+fingerprint+"';const CORE="+json.dumps(assets)+";\n"
    worker+="self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE.map(u=>new Request(u,{cache:'reload'})))).catch(async x=>{await caches.delete(CACHE);throw x;})));\n"
    worker+="self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('inventaire-family-lab-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));\n"
    worker+="self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;const u=new URL(e.request.url);u.search='';if(!CORE.some(p=>new URL(p,self.registration.scope).href===u.href))return;e.respondWith(caches.open(CACHE).then(async c=>(await c.match(u.href))||fetch(e.request)));});"
    (DEST/'sw.js').write_text(worker)
    print('Laboratoire familial fictif construit : dist/family-lab')
if __name__=='__main__':build()
