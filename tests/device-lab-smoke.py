"""Démarrage/arrêt du vrai lanceur de recette et export CLI sans préautorisation."""
from pathlib import Path
import subprocess,os,time,signal,socket,json,urllib.request,tempfile,shutil
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'test-results/phase5';OUT.mkdir(parents=True,exist_ok=True)
project='demo-inventaire-v02'
for k in ['GOOGLE_APPLICATION_CREDENTIALS','FIREBASE_TOKEN']:
 if os.environ.get(k):raise RuntimeError('Production credentials forbidden')
for k in ['GCLOUD_PROJECT','GOOGLE_CLOUD_PROJECT']:
 if os.environ.get(k) not in [None,'',project]:raise RuntimeError('Unexpected project')
env={**os.environ,'GCLOUD_PROJECT':project,'GOOGLE_CLOUD_PROJECT':project,'FIRESTORE_EMULATOR_HOST':'127.0.0.1:8180','FIREBASE_AUTH_EMULATOR_HOST':'127.0.0.1:9099'}
def openport(port):
 with socket.socket() as s:s.settimeout(.1);return s.connect_ex(('127.0.0.1',port))==0
assert not any(openport(p) for p in [8180,9099,8769]),'Local port already occupied'
with tempfile.TemporaryDirectory(prefix='inventaire-smoke-fake-') as tmp:
 log=open(Path(tmp)/'lab.log','w');runner=subprocess.Popen(['node','security/scripts/run-security.mjs','--lab'],cwd=ROOT,env=env,stdout=log,stderr=log,start_new_session=True)
 try:
  started=time.monotonic()
  while time.monotonic()-started<45:
   if runner.poll() is not None:raise RuntimeError('Lab startup failed')
   if openport(8769):break
   time.sleep(.1)
  assert openport(8769)
  with urllib.request.urlopen('http://127.0.0.1:8769/') as r:
   text=r.read().decode();assert r.status==200;assert '<script src="https://' not in text;assert '127.0.0.1:9099' in r.headers['Content-Security-Policy']
  command=['node','--require',str(ROOT/'security/scripts/loopback-only.cjs'),str(ROOT/'security/scripts/recovery.mjs')]
  file=Path(tmp)/'backup.json';summary=json.loads(subprocess.check_output([*command,'backup',str(file)],cwd=ROOT,env=env,text=True));check=json.loads(subprocess.check_output([*command,'verify',str(file)],cwd=ROOT,env=env,text=True));assert summary['counts']=={'products':4,'shoppingLines':0,'operations':0,'members':0};assert check['count']==4
  shutil.copyfile(file,OUT/'backup-fictif-v2.json')
 finally:
  runner.send_signal(signal.SIGINT)
  try:runner.wait(timeout=12)
  except subprocess.TimeoutExpired:os.killpg(runner.pid,signal.SIGTERM);runner.wait(timeout=5)
  log.close()
 for _ in range(50):
  if not any(openport(p) for p in [8180,9099,8769]):break
  time.sleep(.1)
 assert not any(openport(p) for p in [8180,9099,8769]),'Leaked lab process'
 (OUT/'lab-smoke.json').write_text(json.dumps({'startup':True,'anonymousAccountsCreated':0,'membersPreauthorized':0,'completeBackupVerified':True,'documents':4,'checksum':summary['checksum'],'shutdown':'SIGINT, all three ports closed','productionAccess':False},indent=2)+'\n')
 print('PASS laboratoire : démarrage, aucun UID préautorisé, export complet vérifié, SIGINT et trois ports fermés')
