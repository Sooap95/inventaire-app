"""Vérification hors réseau, sans installation ni exécution Firebase."""
from pathlib import Path
import json,hashlib,zipfile
ROOT=Path(__file__).resolve().parents[1];D=ROOT/'dist/preprod-local'
r=json.loads((D/'release.json').read_text());assert r['firebaseSdk'] and not r['cloudExecutionAuthorized'] and not r['publishable'] and not r['webConfigurationComplete']
assert r['projectId']=='inventaire-v02-preprod-a1' and r['projectNumber']=='319106753418'
for f,h in r['files'].items():assert hashlib.sha256((D/f).read_bytes()).hexdigest()==h,f
inputs=json.loads((D/'bundle-inputs.json').read_text());assert inputs['mode']=='preprod-inactive' and inputs['cloudExecutionAuthorized']==False
for f in ['src/family/identity.js','src/family/transport.js','src/mobile/runtime.js','src/preprod/emulator-test-runtime.js','security/src/emulator-admin.mjs','security/src/device-admin.mjs']:assert f not in inputs['inputs'],f
bundle=(D/'src/preprod/preprod.bundle.js').read_text();assert 'A2_L_CLOUD_DISABLED' in bundle and '127.0.0.1:8180' not in bundle and '127.0.0.1:9099' not in bundle
for p in D.rglob('*'):
 if p.is_file():assert b'inventaire-maison-8fd95' not in p.read_bytes(),str(p)
headers=(D/'_headers').read_text();assert "connect-src 'self';" in headers and "worker-src 'self';" in headers and 'unsafe-eval' not in headers
worker=(D/'sw.js').read_text();assert 'shell-integrity' in worker and 'skipWaiting' not in worker and "startsWith('inventaire-preprod-')" in worker
with zipfile.ZipFile(ROOT/'artifacts/Inventaire-Maison-Niveau2-A2L-INACTIF.zip') as z:
 assert z.testzip() is None
 assert {n for n in z.namelist() if not n.endswith('/')}=={str(p.relative_to(D)) for p in D.rglob('*') if p.is_file()}
 for n in z.namelist():
  if not n.endswith('/'):assert z.read(n)==(D/n).read_bytes(),n
print('PASS niveau 2 INACTIF : hashes, SDK distinct, garde cloud fermée, CSP locale, worker et ZIP exacts')
