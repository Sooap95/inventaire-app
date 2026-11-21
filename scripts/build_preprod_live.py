"""Build the separately authorized preproduction package, without network access."""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import zipfile
from build_preprod_local import build as inactive_build

ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'dist/preprod-live'
CSP="default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'"
ALLOWED={'index.html','mobile.css','404.html','guide.html','manifest.json','_headers','bundle-inputs.json','release.json','sw.js','src/family/family.css','src/shopping/manual.css','src/domain/stock.js','src/ui/art-deco.css','src/preprod/live-bootstrap.js','src/preprod/live-target.js','src/preprod/update.js','src/preprod/preprod.bundle.js'}
SCANNER_ASSETS=json.loads((ROOT/'config/preprod/scanner-assets.json').read_text())['files']
ALLOWED.update(SCANNER_ASSETS)
def sha(data):return hashlib.sha256(data).hexdigest()
def admin_lot(binding,approval,release,pages_zip):
    if not release['publishable']:
        print('Lot administratif non émis : sources encore modifiées.');return
    sources={'preprod_cloud_shell.py':ROOT/'scripts/preprod_cloud_shell.py','check_preprod_cloud_shell.py':ROOT/'scripts/check_preprod_cloud_shell.py','rules.firestore':ROOT/'security/firestore.rules','indexes.json':ROOT/'security/firestore.indexes.json','seed.json':ROOT/'config/preprod/seed-a2s-four-products.json','approval.json':ROOT/'config/preprod/live-release.json'}
    manifest={'format':'inventaire-preprod-admin-lot','version':1,'projectId':binding['projectId'],'projectNumber':binding['projectNumber'],'databaseId':binding['databaseId'],'location':binding['location'],'authorizedStages':approval['authorizedStages'],'A3Authorized':False,'initialRulesSourceSha256':approval['initialRulesSourceSha256'],'publicApiKeySha256':sha(binding['firebase']['apiKey'].encode()),'sourceCommit':release['sourceCommit'],'pagesZipSha256':sha(pages_zip.read_bytes()),'files':{name:sha(path.read_bytes()) for name,path in sources.items()}}
    raw=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode();digest=sha(raw)
    command='python3 EXECUTER.py'
    launcher='from pathlib import Path\nimport os,subprocess,sys\nos.chdir(Path(__file__).resolve().parent)\nsubprocess.run([sys.executable,"preprod_cloud_shell.py","--apply","'+digest+'"],check=True)\n'
    guide='LOT APPROUVE A2-D/S/P — PREPRODUCTION UNIQUEMENT\n\nAucune cle ou aucun jeton a fournir. Connexion normale Cloud Shell.\n\nDans Cloud Shell, importer ce ZIP puis executer :\nunzip -n Inventaire-Maison-V02-PREPRODUCTION-CloudShell.zip -d inventaire-a2-'+digest[:10]+'\ncd inventaire-a2-'+digest[:10]+'\n'+command+'\n\nLe script arrete sans publier si les controles echouent. Conserver le resultat et backup-before*.json.\nAttendre BACKEND PRET avant import du ZIP Pages sur Pages Free. Ne pas activer une API ou la facturation.\n\nRetour au deny-all, si necessaire, depuis ce dossier :\npython3 preprod_cloud_shell.py --rollback-rules '+digest+' NOM_DU_BACKUP.json\nAucun document ni index ne sera supprime.\n\nZIP Pages attendu SHA256 : '+manifest['pagesZipSha256']+'\n'
    dest=ROOT/'artifacts/Inventaire-Maison-V02-PREPRODUCTION-CloudShell.zip'
    with zipfile.ZipFile(dest,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for name,path in sources.items():z.write(path,name)
        z.writestr('lot-manifest.json',raw);z.writestr('LANCER.txt',guide);z.writestr('EXECUTER.py',launcher)
    (ROOT/'artifacts/LANCER-PREPRODUCTION.txt').write_text(guide)
    print('Lot Cloud Shell et commande préparés. SHA du manifeste : '+digest)
def build():
    approval=json.loads((ROOT/'config/preprod/live-release.json').read_text())
    binding=json.loads((ROOT/'config/environments/preprod-a2-live.json').read_text())
    if approval['authorizedStages']!=['A2-D','A2-S','A2-P'] or approval['A3Authorized'] is not False:raise RuntimeError('APPROVAL_SCOPE')
    for key in ['projectId','projectNumber','databaseId','location','origin']:
        if binding[key]!=approval[key]:raise RuntimeError('BINDING_MISMATCH')
    for file,key in [('security/firestore.rules','rulesSha256'),('security/firestore.indexes.json','indexesSha256')]:
        if sha((ROOT/file).read_bytes())!=approval[key]:raise RuntimeError('APPROVED_BYTES_CHANGED')
    inactive_build()
    DEST.mkdir(parents=True,exist_ok=True)
    # Refuse unknown leftovers rather than deleting an existing directory.
    if {str(p.relative_to(DEST)) for p in DEST.rglob('*') if p.is_file()}-ALLOWED:raise RuntimeError('UNEXPECTED_EXISTING_ASSET')
    src=ROOT/'dist/preprod-local'
    for file in ['mobile.css','404.html','src/family/family.css','src/shopping/manual.css','src/domain/stock.js','src/ui/art-deco.css','src/preprod/update.js']:
        dest=DEST/file;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(src/file,dest)
    text=(src/'index.html').read_text()
    old=json.loads((ROOT/'config/environments/preprod-a2-local.json').read_text())
    text=text.replace(json.dumps(old,separators=(',',':')),json.dumps(binding,separators=(',',':')))
    text=text.replace('src/preprod/bootstrap.js','src/preprod/live-bootstrap.js').replace('PRÉPRODUCTION INACTIVE','PRÉPRODUCTION').replace('INAKTIVE VORPRODUKTION','VORPRODUKTION')
    # Reuse the historical scanner's DOM and function names in this distribution only.
    before=text.index('let html5Qr = null;');after=text.index('function openLinkModal(code) {',before)
    text=text[:before]+(ROOT/'src/preprod/barcode-scanner.js').read_text()+'\n'+text[after:]
    text=text.replace('</head>','<script src="src/preprod/barcode-assets/html5-qrcode-2.3.8.min.js"></script><script src="src/preprod/barcode-assets/zxing-wasm-2.2.1-reader.js"></script></head>',1)
    for name,digest in SCANNER_ASSETS.items():
        source=ROOT/name
        if sha(source.read_bytes())!=digest:raise RuntimeError('SCANNER_ASSET_INTEGRITY')
        target=DEST/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    if '"apiKey":null' in text:raise RuntimeError('LIVE_BINDING_MISSING')
    (DEST/'index.html').write_text(text)
    shutil.copy2(ROOT/'src/preprod/live-bootstrap.js',DEST/'src/preprod/live-bootstrap.js')
    (DEST/'guide.html').write_text((ROOT/'docs/preprod-live-guide.html').read_text())
    manifest=json.loads((src/'manifest.json').read_text());manifest.update({'name':'Inventaire Maison — PRÉPRODUCTION','short_name':'Inventaire PRÉPROD','description':'Préproduction isolée — profils autorisés uniquement'})
    (DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (DEST/'_headers').write_text('/*\n  Content-Security-Policy: '+CSP+'\n  Permissions-Policy: camera=(self), microphone=(), geolocation=()\n  Referrer-Policy: no-referrer\n  X-Content-Type-Options: nosniff\n  Cache-Control: no-cache\n')
    subprocess.run(['node',str(ROOT/'security/scripts/build-preprod-live-bundle.mjs')],cwd=ROOT,check=True)
    files={str(p.relative_to(DEST)):sha(p.read_bytes()) for p in DEST.rglob('*') if p.is_file() and p.name not in ['release.json','sw.js','_headers']}
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
    dirty=bool(subprocess.check_output(['git','status','--porcelain','--','src','security','scripts','config','tests','docs/preprod-live-guide.html','package.json','package-lock.json'],cwd=ROOT))
    identity=sha(json.dumps({'files':files,'commit':commit},sort_keys=True).encode())
    release={'format':'inventaire-preprod-live-release','version':1,'id':identity,'sourceCommit':commit,'sourceInputsDirty':dirty,'mode':'preprod-live','projectId':binding['projectId'],'projectNumber':binding['projectNumber'],'databaseId':binding['databaseId'],'location':binding['location'],'origin':binding['origin'],'firebaseSdk':True,'publishable':not dirty,'cloudExecutionAuthorized':True,'A3Authorized':False,'initialIdentityRequiresAction':True,'files':files}
    release['features']={'barcodeScanner':True,'formats':['EAN_13','UPC_A','EAN_8'],'scannerLibrary':'html5-qrcode@2.3.8','ocr':False,'voice':False,'externalLookup':False}
    release['barcodeDecoder']='zxing-wasm@2.2.1'
    (DEST/'release.json').write_text(json.dumps(release,ensure_ascii=False,indent=2)+'\n')
    hashes={'./'+p:h for p,h in files.items() if not p.endswith('.html')};hashes.update({'./':files['index.html'],'./guide':files['guide.html'],'./release.json':sha((DEST/'release.json').read_bytes())})
    template=(src/'sw.js').read_text()
    (DEST/'sw.js').write_text("const CACHE='inventaire-preprod-"+identity+"';const ASSETS="+json.dumps(hashes)+";\n"+template[template.index('async function verified'):])
    if {str(p.relative_to(DEST)) for p in DEST.rglob('*') if p.is_file()}!=ALLOWED:raise RuntimeError('ASSET_LIST')
    for p in DEST.rglob('*'):
        if p.is_file() and b'inventaire-maison-8fd95' in p.read_bytes():raise RuntimeError('PRODUCTION_REFERENCE')
    artifact=ROOT/'artifacts/Inventaire-Maison-V02-PREPRODUCTION-Pages.zip'
    with zipfile.ZipFile(artifact,'w',compression=zipfile.ZIP_DEFLATED) as z:
        for p in sorted(DEST.rglob('*')):
            if p.is_file():z.write(p,p.relative_to(DEST))
    # Scanner hotfix: package only. No new Firebase deployment/seed lot is emitted.
    print('Paquet Pages préparé localement ; publiable : '+str(release['publishable'])+' ; aucune publication exécutée.')
if __name__=='__main__':build()
