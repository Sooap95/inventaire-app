"""Vérification hors réseau du paquet niveau 1 et de toutes ses empreintes."""
from pathlib import Path
import hashlib,json,re,zipfile
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'dist/mobile-ui'
release=json.loads((D/'release.json').read_text());assert release['mode']=='ui-fixture' and not release['firebaseSdk'] and not release['realFirebase']
for name,expected in release['files'].items():assert hashlib.sha256((D/name).read_bytes()).hexdigest()==expected,name
inputs=json.loads((D/'bundle-inputs.json').read_text());assert inputs['firebaseSdk']==False;assert not any('node_modules' in n or n.endswith(('family/identity.js','family/transport.js')) for n in inputs['inputs'])
for p in D.rglob('*'):
 if p.is_file():
  data=p.read_bytes();assert b'inventaire-maison-8fd95' not in data;assert not re.search(rb'https://[^\s"<>]*(?:firebaseapp\.com|firebaseio\.com|firestore\.googleapis\.com)',data),str(p)
headers=(D/'_headers').read_text();assert "connect-src 'self';" in headers and "worker-src 'self';" in headers and 'camera=(), microphone=()' in headers
worker=(D/'sw.js').read_text();assert 'skipWaiting' not in worker and 'shell-integrity' in worker and "startsWith('inventaire-mobile-ui-')" in worker
manifest=json.loads((D/'manifest.json').read_text());assert manifest['id']==manifest['scope']==manifest['start_url']=='./' and 'TEST' in manifest['short_name']
with zipfile.ZipFile(ROOT/'artifacts/Inventaire-Maison-Niveau1-mobile.zip') as z:
 assert set(z.namelist())=={str(p.relative_to(D)) for p in D.rglob('*') if p.is_file()}|{str(p.relative_to(D))+'/' for p in D.rglob('*') if p.is_dir()}
 for n in z.namelist():
  if not n.endswith('/'):assert z.read(n)==(D/n).read_bytes(),n
print('PASS paquet niveau 1 : empreintes, frontières sans Firebase, CSP, manifeste, worker et ZIP conformes')
