from pathlib import Path
import hashlib,json,sys,zipfile
from build_preprod_live import ALLOWED,CSP
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'dist/preprod-live'
def check(require_publishable=False):
 r=json.loads((D/'release.json').read_text())
 assert r['mode']=='preprod-live' and r['cloudExecutionAuthorized'] and r['firebaseSdk'] and r['A3Authorized'] is False
 assert r['projectId']=='inventaire-v02-preprod-a1' and r['projectNumber']=='319106753418' and r['origin']=='https://inventaire-maison-v02-recette-sync.pages.dev'
 assert r['initialIdentityRequiresAction'] is True
 if require_publishable:assert r['publishable'] is True and r['sourceInputsDirty'] is False,'Sources modifiées : paquet non publiable'
 assert {str(p.relative_to(D)) for p in D.rglob('*') if p.is_file()}==ALLOWED
 for f,h in r['files'].items():assert hashlib.sha256((D/f).read_bytes()).hexdigest()==h,f
 inputs=json.loads((D/'bundle-inputs.json').read_text());assert inputs['mode']=='preprod-live'
 assert 'src/preprod/live-runtime.js' in inputs['inputs']
 for f in ['src/mobile/runtime.js','src/preprod/runtime.js','src/family/identity.js','src/family/transport.js','src/preprod/emulator-test-runtime.js','security/src/device-admin.mjs','security/src/emulator-admin.mjs']:
  assert f not in inputs['inputs'],f
 for file in D.rglob('*'):
  if file.is_file():assert b'inventaire-maison-8fd95' not in file.read_bytes(),str(file)
 bundle=(D/'src/preprod/preprod.bundle.js').read_text();assert '127.0.0.1:8180' not in bundle and '127.0.0.1:9099' not in bundle
 assert 'www.google.com/images/cleardot.gif' not in bundle
 headers=(D/'_headers').read_text();assert CSP in headers and "'unsafe-eval'" not in headers and '*.google' not in headers
 assert "'wasm-unsafe-eval'" in headers and r['barcodeDecoder']=='zxing-wasm@2.2.1'
 assert 'camera=(self), microphone=(), geolocation=()' in headers
 assert r['features']=={'barcodeScanner':True,'formats':['EAN_13','UPC_A','EAN_8'],'scannerLibrary':'html5-qrcode@2.3.8','ocr':False,'voice':False,'externalLookup':False}
 worker=(D/'sw.js').read_text();assert 'shell-integrity' in worker and 'skipWaiting' not in worker and "startsWith('inventaire-preprod-')" in worker
 assert 'signInAnonymously' not in (D/'src/preprod/live-bootstrap.js').read_text()
 with zipfile.ZipFile(ROOT/'artifacts/Inventaire-Maison-V02-PREPRODUCTION-Pages.zip') as z:
  assert z.testzip() is None and set(z.namelist())==ALLOWED
  for f in ALLOWED:assert z.read(f)==(D/f).read_bytes()
 print('PASS paquet live : cible, empreintes, CSP, SDK dédié, ZIP fermé, aucune identité au chargement initial.')
if __name__=='__main__':check('--require-publishable' in sys.argv)
