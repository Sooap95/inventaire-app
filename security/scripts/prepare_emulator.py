"""Téléchargement volontaire du binaire officiel, aucun projet/service Firebase."""
from pathlib import Path
import json,hashlib,urllib.request,os
ROOT=Path(__file__).resolve().parents[1]
info=json.loads((ROOT/'node_modules/firebase-tools/lib/emulator/downloadableEmulatorInfo.json').read_text())['firestore']
assert info['remoteUrl'].startswith('https://storage.googleapis.com/firebase-preview-drop/emulator/cloud-firestore-emulator-v')
cache=ROOT/'.cache';cache.mkdir(exist_ok=True)
target=cache/info['downloadPathRelativeToCacheDir']
def valid(p):
 return p.is_file() and p.stat().st_size==info['expectedSize'] and hashlib.sha256(p.read_bytes()).hexdigest()==info['expectedChecksumSHA256']
if not valid(target):
 temporary=cache/(target.name+'.part')
 try:
  with urllib.request.urlopen(info['remoteUrl'],timeout=120) as response,temporary.open('wb') as out:
   size=0
   while chunk:=response.read(1024*1024):
    size+=len(chunk)
    if size>info['expectedSize']:raise ValueError('Taille inattendue')
    out.write(chunk)
  if not valid(temporary):raise ValueError('Empreinte du binaire incorrecte')
  os.replace(temporary,target)
 finally:
  if temporary.exists():temporary.unlink()
print('Émulateur Firestore vérifié, version',info['version'])
