"""Self-extracting, pinned Cloud Shell launcher: one uploaded file, one command."""
from pathlib import Path
import base64,hashlib,io,json,zipfile
ROOT=Path(__file__).resolve().parents[1]
def build():
 files={'finaliser_inventaire.py':ROOT/'scripts/finaliser_inventaire.py','sauvegarde_inventaire.py':ROOT/'scripts/sauvegarde_inventaire.py','rules.firestore':ROOT/'security/firestore.rules','indexes.json':ROOT/'security/firestore.indexes.json'}
 manifest={'format':'inventaire-finalisation-lot','version':1,'projectId':'inventaire-maison-8fd95','projectNumber':'272639034410','location':'eur3','files':{name:hashlib.sha256(p.read_bytes()).hexdigest() for name,p in files.items()}}
 raw=io.BytesIO()
 with zipfile.ZipFile(raw,'w',zipfile.ZIP_DEFLATED) as archive:
  content={name:p.read_bytes() for name,p in files.items()};content['final-manifest.json']=(json.dumps(manifest,indent=2)+'\n').encode()
  for name,value in content.items():
   info=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o600<<16;archive.writestr(info,value)
 data=raw.getvalue();digest=hashlib.sha256(data).hexdigest()
 source='''#!/usr/bin/env python3
"""Finalisation autorisée, projet familial uniquement. Aucun secret à fournir."""
import base64,hashlib,io,json,os,sys,zipfile
from pathlib import Path
os.umask(0o077)
DATA=base64.b64decode('''+repr(base64.b64encode(data).decode())+''')
EXPECTED='''+repr(digest)+'''
if hashlib.sha256(DATA).hexdigest()!=EXPECTED:raise SystemExit('Intégrité du lot refusée')
folder=Path.home()/('inventaire-finalisation-v02-'+EXPECTED[:12])
folder.mkdir(mode=0o700,exist_ok=True)
with zipfile.ZipFile(io.BytesIO(DATA)) as archive:
 if set(archive.namelist())!={'finaliser_inventaire.py','sauvegarde_inventaire.py','rules.firestore','indexes.json','final-manifest.json'}:raise SystemExit('Fichiers du lot refusés')
 for name in archive.namelist():
  target=folder/name;content=archive.read(name)
  if target.exists():
   if target.read_bytes()!=content:raise SystemExit('Dossier existant différent : rien écrasé')
  else:
   with target.open('xb') as file:file.write(content)
sys.path.insert(0,str(folder))
from finaliser_inventaire import main
raise SystemExit(main())
'''
 artifact=ROOT/'artifacts/finaliser_inventaire_v02.py';artifact.parent.mkdir(exist_ok=True);artifact.write_text(source)
 print('Lanceur prêt : '+artifact.name+' ; SHA256 '+hashlib.sha256(artifact.read_bytes()).hexdigest())
if __name__=='__main__':build()
