"""Build the final GitHub Pages shell; no SDK execution or cloud write."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,zipfile
ROOT=Path(__file__).resolve().parents[1]
DEST=ROOT/'dist/production'
def sha(b):return hashlib.sha256(b).hexdigest()
CSP="default-src 'none'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firestore.googleapis.com https://world.openfoodfacts.org; worker-src 'self'; manifest-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'"
def build():
 DEST.mkdir(parents=True,exist_ok=True)
 subprocess.run(['node','--input-type=module','-e',"import {verifyA2Files} from './scripts/preprod_files.mjs';if(verifyA2Files().length!==29)throw Error('A2_BASELINE');"],cwd=ROOT,check=True)
 scanner_assets=json.loads((ROOT/'config/preprod/scanner-assets.json').read_text())['files']
 copied=['src/family/family.css','src/shopping/manual.css','src/domain/stock.js','src/ui/art-deco.css','src/production/bootstrap.js','src/production/open-food-facts.js','src/production/vendor/qrcode-1.0.0.min.js','src/production/vendor/qrcode-LICENSE.txt']
 allowed=set(copied)|set(scanner_assets)|{'index.html','manifest.json','.nojekyll','src/production/app.bundle.js','src/production/target.js','bundle-inputs.json','release.json','sw.js'}
 if {str(f.relative_to(DEST)) for f in DEST.rglob('*') if f.is_file()}-allowed:raise RuntimeError('UNEXPECTED_EXISTING_ASSET_NO_OVERWRITE')
 p=json.loads((ROOT/'config/production/binding.json').read_text())
 if (p['projectId'],p['projectNumber'],p['location'],p['origin'],p['basePath'])!=('inventaire-maison-8fd95','272639034410','eur3','https://sooap95.github.io','/inventaire-app/'):raise RuntimeError('PRODUCTION_BINDING')
 text=(ROOT/'index.html').read_text()
 text=re.sub(r'<script src="https://[^\"]+"[^>]*></script>','',text)
 text=text.replace('<script type="module" src="src/shopping/manual-ui.js"></script>','')
 text,n=re.subn(r'const firebaseConfig = \{[\s\S]*?\n\};','const firebaseConfig = {}; // Legacy transport disabled; production runtime owns Auth.',text,count=1)
 if n!=1:raise RuntimeError('LEGACY_CONFIG_REPLACEMENT')
 before=text.index('let html5Qr = null;');after=text.index('function openLinkModal(code) {',before)
 scanner=(ROOT/'src/preprod/barcode-scanner.js').read_text()
 scanner=scanner.replace("?.mode==='preprod'","?.mode==='production'")
 scanner=scanner.replace("new URL('/src/preprod/barcode-assets/zxing_reader.wasm',location.origin)","new URL('src/preprod/barcode-assets/zxing_reader.wasm',new URL('./',location.href))")
 scanner=scanner.replace("document.getElementById('scan-hint').textContent=barcodeWords().stopped;void stopScanIfRunning();","document.getElementById('scan-hint').textContent=barcodeWords().stopped;void stopScanIfRunning();if(!matches.length)void lookupScannedBarcode(code,barcodeSequence);")
 text=text[:before]+scanner+'\n'+text[after:]
 text=text.replace('function registerSW() {','function registerSW() {\n  if(window.FAMILY_LAB_CONFIG?.mode===\'production\')return;')
 text=text.replace('function startVoice(target, btn) {','function startVoice(target, btn) {\n  if(!window.FamilyApp?.allowProductAction())return;')
 # The family renderer uses family-row rather than the old shop-mode-card.
 text=text.replace("'#shopping-mode-content .shop-mode-card'","'#shopping-mode-content .shop-mode-card, #shopping-mode-content .family-row'")
 text=text.replace("(c.dataset.name || '').includes", "(c.dataset.name || c.querySelector('strong')?.textContent?.toLowerCase() || '').includes")
 text=text.replace('src/family/bootstrap.js','src/production/bootstrap.js')
 # Firebase's existing browser key restricts HTTP referrers. Send the origin,
 # never the inventory path/query, across origins. OFF opts out explicitly.
 preamble='<meta http-equiv="Content-Security-Policy" content="'+CSP+'"><meta name="referrer" content="strict-origin-when-cross-origin"><script>window.PRODUCTION_BINDING='+json.dumps(p,separators=(',',':'))+';window.FAMILY_LAB_CONFIG={mode:"production"};</script>'
 text=text.replace('<head>','<head>'+preamble,1)
 for asset in ['src/preprod/barcode-assets/html5-qrcode-2.3.8.min.js','src/preprod/barcode-assets/zxing-wasm-2.2.1-reader.js','src/production/vendor/qrcode-1.0.0.min.js']:
  text=text.replace('</head>','<script src="'+asset+'"></script></head>',1)
 text=text.replace('</body>','<script src="src/production/open-food-facts.js"></script></body>',1)
 text=text.replace('</head>','<style>input,textarea,select{font-size:16px}button,.tab{min-height:44px}#family-network{display:none}body{overflow-wrap:anywhere}.family-row.voice-hit{outline:3px solid #AA2F60}.family-modal{padding-bottom:env(safe-area-inset-bottom)}</style></head>',1)
 (DEST/'index.html').write_text(text)
 files=copied[:]
 assets=scanner_assets
 for name,digest in assets.items():
  if sha((ROOT/name).read_bytes())!=digest:raise RuntimeError('SCANNER_ASSET_INTEGRITY')
 files+=list(assets)
 for name in files:
  target=DEST/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/name,target)
 for name,digest in {'qrcode-1.0.0.min.js':'c541ef06327885a8415bca8df6071e14189b4855336def4f36db54bde8484f36','qrcode-LICENSE.txt':'aaa1f349028a59432eb00222b8ddfe4d2ccebdce04cf8348dcb8d41b7068107b'}.items():
  if sha((DEST/'src/production/vendor'/name).read_bytes())!=digest:raise RuntimeError('QR_ASSET_INTEGRITY')
 manifest=json.loads((ROOT/'manifest.json').read_text());manifest.update(id='./',name='Inventaire Maison',short_name='Inventaire',start_url='./',scope='./',theme_color='#FFF8EE',background_color='#FFF8EE')
 (DEST/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
 (DEST/'.nojekyll').write_text('')
 subprocess.run(['node','security/scripts/build-production-bundle.mjs'],cwd=ROOT,check=True)
 files={str(f.relative_to(DEST)):sha(f.read_bytes()) for f in DEST.rglob('*') if f.is_file() and f.name not in ('sw.js','release.json')}
 commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
 dirty=bool(subprocess.check_output(['git','status','--porcelain','--','src','security','scripts','config','tests','package.json','package-lock.json'],cwd=ROOT))
 identity=sha(json.dumps(files,sort_keys=True).encode())
 release={'format':'inventaire-production-release','version':1,'id':identity,'sourceCommit':commit,'sourceInputsDirty':dirty,'publishable':not dirty,'projectId':p['projectId'],'databaseId':'(default)','location':'eur3','origin':p['origin'],'basePath':p['basePath'],'scannerSource':'b571536','files':files}
 (DEST/'release.json').write_text(json.dumps(release,indent=2)+'\n')
 assets={'./'+name:digest for name,digest in files.items() if not name.startswith('.') and name!='index.html'};assets['./']=files['index.html'];assets['./release.json']=sha((DEST/'release.json').read_bytes())
 worker="const CACHE='inventaire-maison-v02-final-"+identity+"';const ASSETS="+json.dumps(assets)+";\n"
 worker+='''async function verified(url,hash){const response=await fetch(new Request(url,{cache:'reload',credentials:'omit',redirect:'error'}));if(!response.ok||new URL(response.url).origin!==url.origin)throw Error('shell-response');const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');if(actual!==hash)throw Error('shell-integrity');return response;}
self.addEventListener('install',e=>e.waitUntil((async()=>{const entries=await Promise.all(Object.entries(ASSETS).map(async([file,hash])=>{const url=new URL(file,self.registration.scope);return [url.href,await verified(url,hash)];}));const c=await caches.open(CACHE);await Promise.all(entries.map(([url,r])=>c.put(url,r)));})().catch(async error=>{await caches.delete(CACHE);throw error;})));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('inventaire-maison-v02-final-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;const url=new URL(e.request.url);if(url.origin!==location.origin)return;url.search='';url.hash='';if(url.href===new URL('./index.html',self.registration.scope).href)url.href=self.registration.scope;const file=Object.keys(ASSETS).find(k=>new URL(k,self.registration.scope).href===url.href);if(file)e.respondWith(caches.open(CACHE).then(async c=>await c.match(url.href)||verified(url,ASSETS[file])));});
'''
 (DEST/'sw.js').write_text(worker)
 if {str(f.relative_to(DEST)) for f in DEST.rglob('*') if f.is_file()}!=allowed:raise RuntimeError('PRODUCTION_ASSET_SET')
 (ROOT/'artifacts').mkdir(exist_ok=True)
 with zipfile.ZipFile(ROOT/'artifacts/Inventaire-Maison-V02-Finale-GitHub-Pages.zip','w',compression=zipfile.ZIP_DEFLATED) as z:
  for f in sorted(DEST.rglob('*')):
   if f.is_file():z.write(f,f.relative_to(DEST))
 print('Version finale compilée localement : '+str(len(files))+' ressources, aucune publication.')
if __name__=='__main__':build()
