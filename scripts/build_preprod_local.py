"""A2-L : paquet niveau 2 inactif, aucun accès réseau, aucune publication."""
from pathlib import Path
import json,re,shutil,subprocess,hashlib,zipfile
from build_mobile_ui import build as mobile_build,CSP
ROOT=Path(__file__).resolve().parents[1];DEST=ROOT/'dist/preprod-local'
def sha(data):return hashlib.sha256(data).hexdigest()
def build():
    subprocess.run(['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'scripts/plan_preprod.mjs'),'--stage','A2-L'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    binding=json.loads((ROOT/'config/environments/preprod-a2-local.json').read_text())
    if binding!={'version':1,'mode':'preprod','projectId':'inventaire-v02-preprod-a1','projectNumber':'319106753418','databaseId':'(default)','location':'europe-west6','origin':'https://inventaire-maison-v02-recette-sync.pages.dev','firebase':{'apiKey':None,'appId':None,'authDomain':None}}:raise RuntimeError('A2_L_INACTIVE_CONFIGURATION_ONLY')
    mobile_build();source=ROOT/'dist/mobile-ui';DEST.mkdir(parents=True,exist_ok=True)
    for folder in ['src/family','src/shopping','src/domain','src/ui','src/preprod']:(DEST/folder).mkdir(exist_ok=True,parents=True)
    text=(source/'index.html').read_text();text,n=re.subn(r'<script>window.FAMILY_LAB_CONFIG=.*?</script>','<script>window.FAMILY_LAB_CONFIG={mode:"preprod",projectId:"inventaire-v02-preprod-a1"};window.PREPROD_BINDING='+json.dumps(binding,separators=(',',':'))+';localStorage.setItem("app-lang",localStorage.getItem("app-lang")||"fr");localStorage.setItem("user-name","Recette préproduction");window.SpeechRecognition=undefined;window.webkitSpeechRecognition=undefined;</script>',text,count=1)
    if n!=1:raise RuntimeError('PREPROD_PREAMBLE')
    text=text.replace('src/family/bootstrap.js','src/preprod/bootstrap.js').replace('TEST FICTIF','PRÉPRODUCTION INACTIVE').replace('FIKTIVER TEST','INAKTIVE VORPRODUKTION').replace('Inventaire TEST','Inventaire PRÉPROD')
    text=text.replace("if(window.FAMILY_LAB_CONFIG?.mode==='ui-fixture')return;","if(window.FAMILY_LAB_CONFIG)return;")
    (DEST/'index.html').write_text(text)
    for f in ['mobile.css','404.html','src/family/family.css','src/shopping/manual.css','src/domain/stock.js','src/ui/art-deco.css']:shutil.copy2(source/f,DEST/f)
    for f in ['bootstrap.js','target.js','update.js']:shutil.copy2(ROOT/'src/preprod'/f,DEST/'src/preprod'/f)
    (DEST/'guide.html').write_text((ROOT/'docs/preprod-local-guide.html').read_text())
    manifest=json.loads((source/'manifest.json').read_text());manifest.update({'name':'Inventaire Maison — PRÉPRODUCTION INACTIVE','short_name':'Inventaire PRÉPROD','description':'A2-L : connexion cloud désactivée, aucune recette réelle'})
    (DEST/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n');(DEST/'_headers').write_text('/*\n  Content-Security-Policy: '+CSP+'\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Cache-Control: no-cache\n')
    subprocess.run(['node',str(ROOT/'security/scripts/build-preprod-bundle.mjs')],cwd=ROOT,check=True)
    allowed={'index.html','mobile.css','404.html','guide.html','manifest.json','_headers','bundle-inputs.json','release.json','sw.js','src/family/family.css','src/shopping/manual.css','src/domain/stock.js','src/ui/art-deco.css','src/preprod/bootstrap.js','src/preprod/target.js','src/preprod/update.js','src/preprod/preprod.bundle.js'}
    if {str(p.relative_to(DEST)) for p in DEST.rglob('*') if p.is_file()}-allowed:raise RuntimeError('PREPROD_UNEXPECTED_ASSET')
    files={str(p.relative_to(DEST)):sha(p.read_bytes()) for p in DEST.rglob('*') if p.is_file() and p.name not in ['release.json','sw.js','_headers']}
    try:
        source_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,stderr=subprocess.DEVNULL).decode().strip()
        source_dirty=bool(subprocess.check_output(['git','status','--porcelain','--','index.html','manifest.json','src','security','scripts','config','docs/preprod-local-guide.html','package.json','package-lock.json'],cwd=ROOT))
    except (subprocess.CalledProcessError,FileNotFoundError):
        source_commit=None;source_dirty=None
    identity=sha(json.dumps({'files':files,'sourceCommit':source_commit,'sourceInputsDirty':source_dirty},sort_keys=True).encode())
    release={'format':'inventaire-preprod-local-release','version':1,'id':identity,'mode':'preprod-inactive','projectId':binding['projectId'],'projectNumber':binding['projectNumber'],'databaseId':'(default)','location':'europe-west6','cloudExecutionAuthorized':False,'webConfigurationComplete':False,'publishable':False,'firebaseSdk':True,'sourceCommit':source_commit,'sourceInputsDirty':source_dirty,'files':files}
    (DEST/'release.json').write_text(json.dumps(release,indent=2,ensure_ascii=False)+'\n')
    hashes={'./'+p:h for p,h in files.items() if not p.endswith('.html')};hashes.update({'./':files['index.html'],'./guide':files['guide.html'],'./release.json':sha((DEST/'release.json').read_bytes())})
    original=(source/'sw.js').read_text();worker="const CACHE='inventaire-preprod-"+identity+"';const ASSETS="+json.dumps(hashes)+";\n"+original[original.index('async function verified'):].replace('inventaire-mobile-ui-','inventaire-preprod-')
    (DEST/'sw.js').write_text(worker)
    for p in DEST.rglob('*'):
        if p.is_file() and b'inventaire-maison-8fd95' in p.read_bytes():raise RuntimeError('PRODUCTION_REFERENCE')
    archive=ROOT/'artifacts/Inventaire-Maison-Niveau2-A2L-INACTIF.zip';shutil.make_archive(str(archive.with_suffix('')),'zip',DEST)
    print('Paquet niveau 2 INACTIF : dist/preprod-local ; aucune autorisation de publication.')
if __name__=='__main__':build()
