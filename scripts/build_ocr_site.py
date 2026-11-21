"""Assemblage statique local, sans connexion réseau et sans publication."""
from pathlib import Path
import argparse, hashlib, json, shutil, zipfile

ROOT=Path(__file__).resolve().parents[1]
MAX_ASSET=25*1024*1024
CHUNK=16*1024*1024
CSP="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; img-src 'self' blob: data:; style-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-ancestors 'none'"
HEADERS={
    'Content-Security-Policy':CSP,'Referrer-Policy':'no-referrer',
    'X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY',
    'Cross-Origin-Resource-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow, noarchive',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cache-Control':'no-store'
}

def sha(data):return hashlib.sha256(data).hexdigest()
def replace_once(text,old,new):
    if text.count(old)!=1:raise ValueError('Source du prototype modifiée : adaptation à revoir ('+old[:40]+').')
    return text.replace(old,new)

def build(output=None,tag=''):
    old_manifest=json.loads((ROOT/'vendor/ocr-manifest.json').read_text(encoding='utf-8'))
    locked=json.loads((ROOT/'docs/ocr-assets-manifest.json').read_text(encoding='utf-8'))
    if {f['path']:f for f in old_manifest['files']}!={f['path']:f for f in locked['files']}:raise ValueError('Préparer les ressources épinglées avant assemblage.')
    sources=[ROOT/'labs/ocr/app.js',ROOT/'labs/ocr/index.html',ROOT/'labs/ocr/recognizer.worker.js',
             ROOT/'labs/ocr/manifest.webmanifest',ROOT/'labs/ocr/icon.svg',ROOT/'labs/lab.css',ROOT/'src/ocr/lines.js',Path(__file__)]
    sources+=sorted((ROOT/'standalone').glob('*'))+sorted((ROOT/'third_party/ocr-static').glob('*'))
    if not (ROOT/'third_party/ocr-static/sources.json').exists():raise ValueError('Notices tierces absentes.')
    version=sha(b''.join(p.read_bytes() for p in sources if p.is_file())+json.dumps(locked,sort_keys=True).encode()+tag.encode())[:16]
    target=Path(output) if output else ROOT/'dist'/('ocr-site-'+version)
    if target.exists():
        raise FileExistsError('Dossier déjà présent : choisir --output vers un nouveau dossier, sans écrasement.')
    target.mkdir(parents=True)
    release=target/'releases'/version;release.mkdir(parents=True)
    files=[];virtual={}
    def put(path,data,category='shell'):
        if isinstance(data,str):data=data.encode()
        path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
        files.append({'path':'/'+path.relative_to(target).as_posix(),'bytes':len(data),'sha256':sha(data),'category':category})
    def copy(path,dest,category='shell'):put(dest,path.read_bytes(),category)
    for entry in old_manifest['files']:
        source=ROOT/entry['path'];data=source.read_bytes()
        if sha(data)!=entry['sha256'] or len(data)!=entry['bytes']:raise ValueError('Ressource source altérée : '+entry['path'])
        dest=release/entry['path']
        if len(data)>MAX_ASSET:
            parts=[]
            for i,start in enumerate(range(0,len(data),CHUNK)):
                part=dest.with_name(dest.name+f'.part-{i:03}.bin')
                put(part,data[start:start+CHUNK],'models');parts.append('/'+part.relative_to(target).as_posix())
            virtual['/'+dest.relative_to(target).as_posix()]={'bytes':len(data),'sha256':sha(data),'parts':parts}
        else:put(dest,data,'models')
    # Métadonnées de taille/version, sans requête vers les sources amont.
    put(release/'vendor/ocr-manifest.json',json.dumps({k:v for k,v in old_manifest.items() if k!='files'}))
    copy(ROOT/'labs/lab.css',release/'lab.css')
    copy(ROOT/'src/ocr/lines.js',release/'lines.js')
    copy(ROOT/'labs/ocr/icon.svg',release/'icon.svg')
    copy(ROOT/'standalone/network.js',release/'network.js')
    network=(ROOT/'standalone/network.js').read_text(encoding='utf-8').replace('export { installAssetFetch };','self.installAssetFetch=installAssetFetch;')
    put(release/'network.classic.js',network)
    copy(ROOT/'standalone/lifecycle.js',release/'lifecycle.js')
    copy(ROOT/'standalone/capabilities.js',release/'capabilities.js')
    # Façade de l'interface existante : seuls les chemins et contrôles de cycle de vie changent.
    app=(ROOT/'labs/ocr/app.js').read_text(encoding='utf-8')
    app=replace_once(app,"from '../../src/ocr/lines.js'","from './lines.js'")
    app=replace_once(app,"new URL('../../',import.meta.url)","new URL('./',import.meta.url)")
    app=replace_once(app,'let busy=false;','let busy=false,modelsReady=false;')
    app=replace_once(app,'value||!photo.width||!manifest;','value||!photo.width||!manifest||!modelsReady;')
    app=replace_once(app,"$('offline').disabled=true;","$('offline').disabled=true;modelsReady=false;setBusy(busy);$('offline-status').textContent='Téléchargement volontaire et vérification des ressources…';")
    app=replace_once(app,"const result=await cacheCommand('prepare');","const result=await cacheCommand('prepare');modelsReady=result.complete;setBusy(busy);")
    app=replace_once(app,"const result=await cacheCommand('status');","const result=await cacheCommand('status');modelsReady=result.complete;setBusy(busy);")
    app=app.replace('crypto.randomUUID()',"(crypto.randomUUID?.()||Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join(''))")
    app+="\n"+"import { setupLifecycle } from './lifecycle.js';\n"
    app+=f"await setupLifecycle({{clear,isBusy:()=>busy||$('offline').disabled,disable:()=>{{for(const e of document.querySelectorAll('button,input,textarea,select'))e.disabled=true;}},cacheCommand,version:'{version}'}});\n"
    app+="try{const state=await cacheCommand('status');modelsReady=state.complete;setBusy(busy);}catch{}\n"
    app+="import { setupCapabilities } from './capabilities.js';\nsetupCapabilities();\n"
    put(release/'app.js',app)
    # Même moteur et mêmes paramètres, avec garde réseau avant tout import tiers.
    old_worker=(ROOT/'labs/ocr/recognizer.worker.js').read_text(encoding='utf-8')
    prefix="import { installAssetFetch } from './network.js';\nimport { ASSETS } from './asset-index.js';\nconst root=new URL('./',import.meta.url);\ninstallAssetFetch(ASSETS,root);\nfor(const name of ['log','warn','error','info','debug'])console[name]=()=>{};\nlet tess=null,pipeline=null;\nconst progress=message=>postMessage({type:'progress',message});\n"
    worker=prefix+old_worker[old_worker.index('onmessage ='):]
    worker=worker.replace("new URL('labs/ocr/tesseract.worker.js',root)","new URL('tesseract.worker.js',root)")
    worker=replace_once(worker,"message:String(e.message||e)","message:'Moteur indisponible : modèle, capacité WASM ou mémoire à vérifier.'")
    put(release/'recognizer.worker.js',worker)
    put(release/'capabilities.worker.js',"postMessage(Object.fromEntries(['OffscreenCanvas','createImageBitmap','WebAssembly','ReadableStream'].map(k=>[k,typeof self[k]!=='undefined'])));close();\n")
    put(release/'tesseract.worker.js',"importScripts('./network.classic.js','./asset-index.classic.js');\ninstallAssetFetch(OCR_ASSETS,new URL('./',self.location.href));\nfor(const name of ['log','warn','error','info','debug'])console[name]=()=>{};\nimportScripts('./vendor/tesseract/worker.min.js');\n")
    entry="import { installAssetFetch } from './network.js';\nimport { ASSETS } from './asset-index.js';\nif(location.hostname==='sooap95.github.io'){document.body.textContent='Origine de production interdite : utiliser le laboratoire isolé.';}else{installAssetFetch(ASSETS,new URL('./',import.meta.url));await import('./app.js');}\n"
    put(release/'entry.js',entry)
    # Notices sources immuables et licences des bibliothèques embarquées, pas des dépendances natives inutilisées.
    licenses=ROOT/'third_party/ocr-static'
    license_sources=json.loads((licenses/'sources.json').read_text(encoding='utf-8'))
    for record in license_sources:
        if sha((licenses/record['file']).read_bytes())!=record['sha256']:raise ValueError('Notice amont modifiée.')
    for path in sorted(licenses.glob('*')):
        if path.is_file():copy(path,release/'licenses'/path.name)
    for package in ['@huggingface/transformers','@huggingface/jinja','tesseract.js','tesseract.js-core','regenerator-runtime','zlibjs','bmp-js','is-url','wasm-feature-detect','protobufjs','flatbuffers','long']:
        directory=ROOT/'node_modules'/package
        notices=sorted(p for p in directory.glob('*') if p.is_file() and (p.name.upper().startswith('LICENSE') or p.name.upper().startswith('NOTICE')))
        if not notices:raise ValueError('Licence npm absente : '+package)
        for notice in notices:copy(notice,release/'licenses'/(package.replace('/','-')+'-'+notice.name+'.txt'))
    copy(ROOT/'standalone/THIRD-PARTY.txt',release/'THIRD-PARTY.txt')
    put(release/'licences-index.json',json.dumps({'sources':license_sources,'modelRevision':old_manifest['trocrRevision']}))
    html=(ROOT/'labs/ocr/index.html').read_text(encoding='utf-8')
    start=html.index('<meta http-equiv="Content-Security-Policy"');end=html.index('>',start)+1
    html=html[:start]+f'<meta http-equiv="Content-Security-Policy" content="{CSP}">'+html[end:]
    html=replace_once(html,'href="manifest.webmanifest"',f'href="/releases/{version}/manifest.webmanifest"')
    html=replace_once(html,'href="../lab.css"',f'href="/releases/{version}/lab.css"')
    html=replace_once(html,'src="app.js"',f'src="/releases/{version}/entry.js"')
    html=html.replace('Préparer les ressources hors ligne','Télécharger volontairement les moteurs (~118 Mio)')
    html=html.replace('<p id="offline-status"','<p>Le mode assisté fonctionne sans les moteurs. La reconnaissance est activée après leur téléchargement volontaire.</p><p id="capabilities" role="status">Vérification des capacités du navigateur…</p><p id="offline-status"')
    html=html.replace('<p><a href="../backup/">Atelier de sauvegarde isolé</a></p>',f'<p><a href="/releases/{version}/THIRD-PARTY.txt">Licences et attributions</a></p>')
    controls='''<section><h2>Version et désinstallation</h2><p id="version"></p><button id="check-update">Chercher une mise à jour</button><button id="apply-update" disabled>Appliquer et recharger</button><label><input id="discard-confirm" type="checkbox"> J’ai exporté ce que je souhaite conserver ; je confirme la libération des brouillons avant mise à jour ou désinstallation.</label><button id="uninstall">Désinstaller ce laboratoire</button><p id="lifecycle-status" role="status" aria-live="polite"></p></section>
<section id="confidentialite"><h2>Confidentialité</h2><p>Les photos, recadrages et textes restent en mémoire sur cet appareil. Aucun envoi, aucune audience mesurée, aucun journal distant de résultats. L’hébergeur reçoit seulement les demandes de fichiers statiques et leurs métadonnées réseau habituelles. Exporter les mesures est une action locale volontaire. Le cache contient uniquement les ressources du laboratoire et les modèles ; le navigateur peut l’évincer.</p><p>Le mode assisté fonctionne sans téléchargement des moteurs. Fermer l’onglet peut perdre les brouillons. Après désinstallation, fermer les onglets et retirer l’icône de l’écran d’accueil.</p></section>'''
    html=html.replace('</body>',controls+'\n</body>')
    put(target/'index.html',html)
    # Cloudflare redirige index.html vers / : utiliser la route canonique dans le cache.
    files[-1]['path']='/'
    manifest=json.loads((ROOT/'labs/ocr/manifest.webmanifest').read_text(encoding='utf-8'));manifest.update({'id':'/','start_url':'/','scope':'/'})
    put(release/'manifest.webmanifest',json.dumps(manifest))
    put(target/'404.html','<!doctype html><html lang="fr"><meta charset="utf-8"><title>Fichier absent</title><p>Fichier absent du laboratoire OCR.</p></html>')
    put(target/'robots.txt','User-agent: *\nDisallow: /\n')
    # Bootstrap sans cycle de checksum : ces deux fichiers portent les hashes des autres ressources.
    meta_files=['/'+(release/name).relative_to(target).as_posix() for name in ['asset-index.js','asset-index.classic.js','resources.json']]
    bootstrap={'files':files+[{'path':p} for p in meta_files],'virtualFiles':virtual}
    put(release/'asset-index.js','export const ASSETS='+json.dumps(bootstrap,separators=(',',':'))+';\n')
    put(release/'asset-index.classic.js','self.OCR_ASSETS='+json.dumps(bootstrap,separators=(',',':'))+';\n')
    resource_manifest={'version':version,'files':files,'virtualFiles':virtual}
    (release/'resources.json').write_text(json.dumps(resource_manifest,indent=2)+'\n',encoding='utf-8')
    (target/'sw.js').write_text((ROOT/'standalone/sw.js').read_text(encoding='utf-8').replace('__VERSION__',version),encoding='utf-8')
    (target/'_headers').write_text('/*\n'+''.join(f'  {k}: {v}\n' for k,v in HEADERS.items()),encoding='utf-8')
    # Rapport de construction conservé hors répertoire à publier.
    all_files=[p for p in target.rglob('*') if p.is_file()]
    if len(all_files)>1000 or any(p.stat().st_size>MAX_ASSET for p in all_files):raise ValueError('Limite Pages dépassée.')
    report={'version':version,'fileCount':len(all_files),'totalBytes':sum(p.stat().st_size for p in all_files),
            'largestAssetBytes':max(p.stat().st_size for p in all_files),'virtualModelCount':len(virtual),'plannedOrigin':'https://inventaire-maison-ocr-test.pages.dev','published':False}
    target.with_suffix('.build.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    archive_path=target.with_suffix('.zip')
    with zipfile.ZipFile(archive_path,'x',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for path in sorted(all_files):archive.write(path,path.relative_to(target).as_posix())
    return target,report

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--output');parser.add_argument('--tag',default='');args=parser.parse_args()
    path,report=build(args.output,args.tag)
    print(json.dumps({'directory':str(path),**report},indent=2))
