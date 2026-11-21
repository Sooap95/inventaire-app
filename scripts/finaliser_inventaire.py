#!/usr/bin/env python3
"""Owner's normal Cloud Shell session. Single pinned production project only.

No service activation, billing, Auth account creation or document discovery outside
the historical default database. Migration is an atomic compare-and-swap batch.
The complete backups and journal stay private; only the small result is shareable.
"""
import argparse,copy,datetime as dt,fcntl,hashlib,json,os,re,subprocess,sys,time
from pathlib import Path
import urllib.request,urllib.error,urllib.parse
from sauvegarde_inventaire import (Reader,NoRedirect,Stop,require,canonical,digest,
    snapshot,scalar,micros,model_report,write_private,PROJECT,DATABASE,DOCUMENTS,export)

ROOT=Path(__file__).resolve().parent
NUMBER='272639034410'
RULE='/v1/projects/'+PROJECT
MIGRATION='migration_v02_'+ 'd3ce8b34109ac9369a439d008c9c7a85db06c66f9b71440efdb496b82ae5a8bd'[:32]
BACKUP_SHA='946468c757deb597354bc8801108fc38bc3ed9f94a25da0dec4600b0048157ee'
BACKUP_CHECKSUM='d3ce8b34109ac9369a439d008c9c7a85db06c66f9b71440efdb496b82ae5a8bd'
ORIGINAL_RULES='fb31fcc82e8987321c1db0eddf21c7d0159539d0e564d17652dd6c5c9cc6a8ef'
FIELDS={('products','legacy'),('shoppingLines','contributions'),('shoppingLines','checks'),('operations','after'),('operations','receipt')}
def sha(raw):return hashlib.sha256(raw).hexdigest()
def string(x):return {'stringValue':x}
def integer(x):return {'integerValue':str(x)}
def timestamp(x):return {'timestampValue':x}
def doc_path(collection,id):
 require(collection in ('products','shoppingLines','operations','members') and isinstance(id,str) and bool(id.strip()) and '/' not in id and id not in ('.','..'),'DOCUMENT_TARGET')
 return DOCUMENTS+'/'+collection+'/'+id
def normalize(x):
 if isinstance(x,dict):
  if set(x)=={'timestampValue'}:return {'timestampValue':dt.datetime.fromisoformat(x['timestampValue'].replace('Z','+00:00')).astimezone(dt.timezone.utc).isoformat()}
  return {k:normalize(v) for k,v in x.items()}
 if isinstance(x,list):return [normalize(v) for v in x]
 return x
def source_hash(ruleset):return digest(ruleset.get('source',{}))
def load_package():
 manifest=json.loads((ROOT/'final-manifest.json').read_text())
 require(manifest.get('format')=='inventaire-finalisation-lot' and manifest.get('version')==1,'PACKAGE_FORMAT')
 require(manifest['projectId']==PROJECT and manifest['projectNumber']==NUMBER and manifest['location']=='eur3','PACKAGE_TARGET')
 require(set(manifest['files'])=={'finaliser_inventaire.py','sauvegarde_inventaire.py','rules.firestore','indexes.json'},'PACKAGE_FILES')
 for name,value in manifest['files'].items():require(sha((ROOT/name).read_bytes())==value,'PACKAGE_INTEGRITY')
 return manifest

class Admin:
 def __init__(self,reader):self.reader=reader;self.writes=0
 def request(self,host,path,body=None,method='GET'):
  """Closed API list. Rechecked for each call; no automatic write retries."""
  route=urllib.parse.unquote(path.split('?')[0]);data=None
  rules=host=='firebaserules.googleapis.com'
  firestore=host=='firestore.googleapis.com'
  allowed=method=='GET' and ((rules and (route==RULE+'/releases/cloud.firestore' or re.fullmatch(RULE+r'/rulesets/[A-Za-z0-9_-]+',route))) or (firestore and (route.startswith('/v1/'+DATABASE+'/collectionGroups/') or route.startswith('/v1/'+DOCUMENTS+'/'))))
  allowed=allowed or (host=='identitytoolkit.googleapis.com' and method=='GET' and route=='/admin/v2/projects/'+PROJECT+'/config')
  lookup=host=='identitytoolkit.googleapis.com' and method=='POST' and route=='/v1/projects/'+PROJECT+'/accounts:lookup'
  allowed=allowed or lookup
  if lookup:require(set(body)=={'localId'} and len(body['localId'])==1 and valid_uid(body['localId'][0]),'AUTH_LOOKUP_ONLY')
  if rules and method=='POST' and path==RULE+'/rulesets':
   require(body=={'source':{'files':[{'name':'firestore.rules','content':(ROOT/'rules.firestore').read_text()}]}},'RULE_SOURCE');allowed=True
  if rules and method=='PATCH' and path==RULE+'/releases/cloud.firestore':
   require(set(body)=={'release'} and set(body['release'])=={'name','rulesetName'} and body['release']['name']=='projects/'+PROJECT+'/releases/cloud.firestore' and re.fullmatch('projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',body['release']['rulesetName']),'RULE_RELEASE');allowed=True
  if firestore and method=='POST' and path=='/v1/'+DATABASE+'/collectionGroups/operations/indexes':
   spec=json.loads((ROOT/'indexes.json').read_text())['indexes'][0];require(body=={k:v for k,v in spec.items() if k!='collectionGroup'},'INDEX_SOURCE');allowed=True
  if firestore and method=='PATCH' and any(path==f'/v1/{DATABASE}/collectionGroups/{c}/fields/{f}?updateMask=indexConfig' for c,f in FIELDS):
   require(body=={'indexConfig':{'indexes':[]}},'FIELD_SOURCE');allowed=True
  if firestore and method=='POST' and path=='/v1/'+DATABASE+'/documents:commit':
   validate_writes(body);allowed=True
  require(allowed,'ADMIN_REQUEST_REFUSED')
  headers={'Authorization':'Bearer '+self.reader.token,'X-Goog-User-Project':PROJECT,'Content-Type':'application/json'}
  req=urllib.request.Request('https://'+host+path,data=canonical(body) if body is not None else None,method=method,headers=headers)
  if method not in ('GET',) and not lookup:self.writes+=1
  try:
   with self.reader.opener.open(req,timeout=55) as response:return json.loads(response.read(32*1024*1024))
  except urllib.error.HTTPError as error:
   if error.code==404 and method=='GET':return None
   self.reader.last_diagnostic={'api':host,'operation':'finalisation','httpStatus':error.code};self.reader.read_failure(error)
   raise Stop('ADMIN_HTTP_'+str(error.code)+'_REEXECUTER_LE_MEME_LOT') from None
  except (urllib.error.URLError,TimeoutError):raise Stop('RESULTAT_RESEAU_INCERTAIN_REEXECUTER_LE_MEME_LOT') from None
 def pages(self,path,key):
  out=[]
  for _ in range(100):
   value=self.request('firestore.googleapis.com',path) or {};out.extend(value.get(key,[]));token=value.get('nextPageToken')
   if not token:return out
   path=path.split('?')[0]+'?pageToken='+urllib.parse.quote(token,safe='')
  raise Stop('PAGINATION_LIMIT')
 def get(self,collection,id):return self.request('firestore.googleapis.com','/v1/'+urllib.parse.quote(doc_path(collection,id),safe='/'))
 def commit(self,writes):return self.request('firestore.googleapis.com','/v1/'+DATABASE+'/documents:commit',{'writes':writes},'POST')

def valid_uid(uid):return isinstance(uid,str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{6,128}',uid))
def validate_writes(body):
 require(isinstance(body,dict) and set(body)=={'writes'} and 1<=len(body['writes'])<=400,'BATCH_FORMAT')
 paths=set()
 for write in body['writes']:
  require(set(write)=={'update','currentDocument'} and set(write['update'])=={'name','fields'} and len(canonical(write))<900000,'BATCH_WRITE_FORMAT')
  name=write['update']['name'];parts=name.removeprefix(DOCUMENTS+'/').split('/')
  require(name.startswith(DOCUMENTS+'/') and len(parts)==2 and name not in paths and parts[0] in ('products','members','operations'),'BATCH_SCOPE');paths.add(name)
  require(write['currentDocument']=={'exists':False} or (set(write['currentDocument'])=={'updateTime'} and isinstance(write['currentDocument']['updateTime'],str)),'BATCH_PRECONDITION')
  fields=write['update']['fields']
  if parts[0]=='products':require(scalar(fields,'schemaVersion')==2 and scalar(fields,'id')==parts[1] and scalar(fields,'revision')==1 and scalar(fields,'lastOperationId')==MIGRATION,'MIGRATION_ONLY')
  if parts[0]=='operations':require(parts[1]==MIGRATION and scalar(fields,'kind')=='migration.record' and write['currentDocument']=={'exists':False},'MIGRATION_RECORD_ONLY')
  if parts[0]=='members':require(len(body['writes'])==1 and set(fields)=={'schemaVersion','uid','role','authType','status','label','revision','updatedAt','lastAdminOperationId'} and scalar(fields,'uid')==parts[1] and scalar(fields,'schemaVersion')==2 and scalar(fields,'role')=='device' and scalar(fields,'authType')=='anonymous' and scalar(fields,'status') in ('active','revoked') and type(scalar(fields,'revision')) is int and 1<=scalar(fields,'revision')<=2**53-1,'MEMBERS_ONLY')

def project_check(reader,admin):
 project=reader.read('cloudresourcemanager.googleapis.com','/v1/projects/'+PROJECT)
 require(project.get('projectId')==PROJECT and str(project.get('projectNumber'))==NUMBER and project.get('lifecycleState')=='ACTIVE','PROJECT_CHANGED')
 billing=reader.read('cloudbilling.googleapis.com','/v1/projects/'+PROJECT+'/billingInfo')
 require(billing.get('billingEnabled') is False and not billing.get('billingAccountName'),'FREE_PLAN_REQUIRED')
 database=reader.read('firestore.googleapis.com','/v1/'+DATABASE)
 require(database.get('name')==DATABASE and database.get('locationId')=='eur3' and database.get('freeTier') is True and database.get('databaseEdition','STANDARD')=='STANDARD' and database.get('type')=='FIRESTORE_NATIVE','DATABASE_CHANGED')
 auth=admin.request('identitytoolkit.googleapis.com','/admin/v2/projects/'+PROJECT+'/config')
 require(auth and auth.get('signIn',{}).get('anonymous',{}).get('enabled') is True,'ANONYMOUS_AUTH_NOT_ENABLED')

def read_original(backup_path):
 raw=backup_path.read_bytes();require(sha(raw)==BACKUP_SHA,'ORIGINAL_BACKUP_FILE_HASH')
 backup=json.loads(raw);require(backup.get('checksum')==BACKUP_CHECKSUM and digest({k:v for k,v in backup.items() if k!='checksum'})==BACKUP_CHECKSUM,'ORIGINAL_BACKUP_CHECKSUM')
 require((backup.get('projectId'),backup.get('projectNumber'),backup.get('databaseId'),backup.get('database',{}).get('locationId'))==(PROJECT,NUMBER,'(default)','eur3'),'ORIGINAL_BACKUP_TARGET')
 require(source_hash(backup['publishedRuleset'])==ORIGINAL_RULES,'ORIGINAL_RULES')
 review=model_report(backup['data']);require(review['rootDocumentCounts']=={'products':37,'shoppingLines':0,'members':0,'operations':0} and not review['basicReviewIssues'] and not review['otherOrNestedDocumentCount'],'ORIGINAL_MODEL')
 return backup

def convert(document,stamp):
 path=document['name'];require(path.startswith(DOCUMENTS+'/products/') and '/' not in path[len(DOCUMENTS+'/products/'):],'PRODUCT_PATH')
 id=path.split('/')[-1];f=copy.deepcopy(document.get('fields',{}))
 require(0<len(id.strip())<=128 and ('id' not in f or scalar(f,'id')==id),'PRODUCT_ID')
 require('schemaVersion' not in f and 'stockMicros' not in f,'ALREADY_CANONICAL')
 for key,maxlen in [('name',180),('unit',64)]:require(isinstance(scalar(f,key),str) and 0<len(scalar(f,key).strip())<=maxlen,'TEXT_FIELD_REVIEW')
 frequency=scalar(f,'frequency') or '';require(frequency in ('','quotidien','hebdomadaire','mensuel','trimestriel'),'FREQUENCY_REVIEW')
 restocked=scalar(f,'lastRestocked');last={'nullValue':None}
 if restocked:
  require(isinstance(restocked,str),'RESTOCKED_TYPE')
  try:
   date=dt.datetime.fromisoformat(restocked.replace('Z','+00:00'));require(date.tzinfo is not None,'RESTOCKED_TIMEZONE');last=timestamp(date.astimezone(dt.timezone.utc).isoformat().replace('+00:00','Z'))
  except (ValueError,TypeError):raise Stop('RESTOCKED_DATE') from None
 fields={'schemaVersion':integer(2),'id':string(id),'revision':integer(1),'name':copy.deepcopy(f['name']),'unit':copy.deepcopy(f['unit']),
  'frequency':string(frequency),'lastRestocked':last,'deleted':{'booleanValue':False},'legacy':{'mapValue':{'fields':f}},
  'createdBy':string('migration-admin-v02'),'authorUid':string('migration-admin-v02'),'updatedAt':timestamp(stamp),'lastOperationId':string(MIGRATION)}
 for before,after in [('stock','stockMicros'),('threshold','thresholdMicros'),('target','targetMicros')]:fields[after]=integer(micros(scalar(f,before)))
 require(len(canonical(fields))<=700000,'DOCUMENT_SIZE')
 return {'name':path,'fields':fields}

def rules_current(admin):
 release=admin.request('firebaserules.googleapis.com',RULE+'/releases/cloud.firestore')
 require(release and re.fullmatch('projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',release.get('rulesetName','')),'RELEASE_TARGET')
 rules=admin.request('firebaserules.googleapis.com','/v1/'+release['rulesetName']);require(bool(rules),'RULESET_MISSING')
 return release,rules
def rules_expected(rules):return [(f.get('name'),f.get('content')) for f in rules.get('source',{}).get('files',[])]==[('firestore.rules',(ROOT/'rules.firestore').read_text())]

def setup_indexes(admin,folder):
 before=admin.pages('/v1/'+DATABASE+'/collectionGroups/-/indexes','indexes')
 print('Préparation des index gratuits ; aucune quantité modifiée.',flush=True)
 field_before={collection+'/'+field:admin.request('firestore.googleapis.com',f'/v1/{DATABASE}/collectionGroups/{collection}/fields/{field}') for collection,field in sorted(FIELDS)}
 backup=folder/'index-avant-finalisation.json'
 if not backup.exists():write_private(backup,{'indexes':before,'fields':field_before})
 desired=json.loads((ROOT/'indexes.json').read_text())['indexes'][0];expected={k:v for k,v in desired.items() if k!='collectionGroup'}
 def matching(index):return index.get('queryScope')==expected['queryScope'] and index.get('fields',[])[:2]==expected['fields'] and '/collectionGroups/operations/' in index.get('name','')
 if not any(matching(i) for i in before):admin.request('firestore.googleapis.com','/v1/'+DATABASE+'/collectionGroups/operations/indexes',expected,'POST')
 for collection,field in sorted(FIELDS):
  path=f'/v1/{DATABASE}/collectionGroups/{collection}/fields/{field}'
  current=field_before[collection+'/'+field]
  if current is None or current.get('indexConfig',{}).get('indexes')!=[] or current.get('indexConfig',{}).get('usesAncestorConfig',False):admin.request('firestore.googleapis.com',path+'?updateMask=indexConfig',{'indexConfig':{'indexes':[]}},'PATCH')
 for _ in range(30):
  indexes=admin.pages('/v1/'+DATABASE+'/collectionGroups/-/indexes','indexes')
  if any(matching(i) and i.get('state')=='READY' for i in indexes):return before
  require(not any(matching(i) and i.get('state')=='NEEDS_REPAIR' for i in indexes),'INDEX_NEEDS_REPAIR')
  time.sleep(4)
 raise Stop('INDEX_EN_CONSTRUCTION_REEXECUTER_LE_MEME_LOT')

def migrate(reader,admin,original,folder):
 journal_path=folder/'journal-finalisation-v02.json'
 final_rules_path=folder/'rules-finalisation-v02.json'
 marker=admin.get('operations',MIGRATION)
 if marker:
  require(scalar(marker.get('fields',{}),'sourceChecksum')==BACKUP_CHECKSUM,'MIGRATION_RECORD_CONFLICT')
  require(journal_path.exists(),'PRIVATE_JOURNAL_REQUIRED')
  _,rules=rules_current(admin);require(rules_expected(rules),'FINAL_RULES_CHANGED')
  current=snapshot(reader);current_names={d['name'] for d in current['documents']}
  require({d['name'] for d in original['data']['documents']}<=current_names,'MIGRATED_PRODUCT_MISSING')
  require(all(scalar(d['fields'],'schemaVersion')==2 for d in current['documents'] if d['name'].startswith(DOCUMENTS+'/products/')),'MIGRATED_SCHEMA_CHANGED')
  # After normal purchases, the historical migration remains complete. Never reset it.
  return {'backendReady':True,'migration':'already-applied-no-write','productCount':37}
 if not journal_path.exists():
  release,rules=rules_current(admin);require(source_hash(rules)==ORIGINAL_RULES,'CURRENT_RULES_UNEXPECTED')
  fresh_dir=folder/('avant-finalisation-'+str(time.time_ns()));fresh_dir.mkdir(mode=0o700)
  fresh=export(reader,fresh_dir);require(not fresh['basicReviewIssues'] and fresh['rootDocumentCounts']=={'products':37,'shoppingLines':0,'members':0,'operations':0} and fresh['otherOrNestedDocumentCount']==0,'FRESH_MODEL_CHANGED')
  backup=json.loads((fresh_dir/'sauvegarde-complete.json').read_text())
  require({d['name'] for d in backup['data']['documents']}=={d['name'] for d in original['data']['documents']},'PRODUCT_SET_CHANGED')
  stamp=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z')
  # Complete conversion and bounds validation before publishing any rule.
  for document in backup['data']['documents']:convert(document,stamp)
  write_private(journal_path,{'format':'inventaire-finalisation-private','version':1,'originalBackupChecksum':BACKUP_CHECKSUM,'previousRelease':release,'previousRuleset':rules,'freshBackupFolder':str(fresh_dir),'createdAt':stamp})
 journal=json.loads(journal_path.read_text());require(journal['originalBackupChecksum']==BACKUP_CHECKSUM,'JOURNAL_TARGET')
 setup_indexes(admin,folder)
 release,rules=rules_current(admin)
 if not rules_expected(rules):
  require(source_hash(rules)==ORIGINAL_RULES,'CURRENT_RULES_UNEXPECTED')
  if final_rules_path.exists():created=json.loads(final_rules_path.read_text())
  else:
   created=admin.request('firebaserules.googleapis.com',RULE+'/rulesets',{'source':{'files':[{'name':'firestore.rules','content':(ROOT/'rules.firestore').read_text()}]}},'POST')
   require(created and re.fullmatch('projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',created.get('name','')),'NEW_RULESET_TARGET');write_private(final_rules_path,created)
  admin.request('firebaserules.googleapis.com',RULE+'/releases/cloud.firestore',{'release':{'name':'projects/'+PROJECT+'/releases/cloud.firestore','rulesetName':created['name']}},'PATCH')
 _,rules=rules_current(admin);require(rules_expected(rules),'RULES_NOT_PUBLISHED')
 # New rules can take up to a minute to reach new requests. Old cached tabs
 # must be closed by the owner; never convert while a flat write is still allowed.
 propagation=folder/'propagation-regles-v02.json'
 if not propagation.exists():write_private(propagation,{'publishedAt':time.time()})
 elapsed=time.time()-json.loads(propagation.read_text())['publishedAt']
 if elapsed<90:
  print('Protection des anciennes écritures : attente de propagation des règles (90 s maximum).',flush=True)
  while elapsed<90:
   time.sleep(min(5,90-elapsed));elapsed=time.time()-json.loads(propagation.read_text())['publishedAt']
 # Empty members deny both the old and the new client during conversion.
 data=snapshot(reader);require(digest(data)==digest(snapshot(reader)),'CONCURRENT_ADMIN_WRITES')
 review=model_report(data);require(review['rootDocumentCounts']=={'products':37,'shoppingLines':0,'members':0,'operations':0} and not review['basicReviewIssues'] and not review['otherOrNestedDocumentCount'],'FROZEN_MODEL_CHANGED')
 require({d['name'] for d in data['documents']}=={d['name'] for d in original['data']['documents']},'FROZEN_IDS_CHANGED')
 # Persist the exact last values after the rules freeze; do not rely on an older stock.
 plan_path=folder/'plan-conversion-v02.json'
 if plan_path.exists():
  plan=json.loads(plan_path.read_text());require(plan.get('checksum')==digest({k:v for k,v in plan.items() if k!='checksum'}),'PRIVATE_PLAN_CHECKSUM');require(digest(data)==plan['beforeDigest'],'DATA_CHANGED_SINCE_PLAN')
 else:
  stamp=journal['createdAt'];updates=[convert(d,stamp) for d in data['documents']]
  writes=[{'update':after,'currentDocument':{'updateTime':before['updateTime']}} for before,after in zip(data['documents'],updates)]
  event={'name':doc_path('operations',MIGRATION),'fields':{'schemaVersion':integer(1),'kind':string('migration.record'),'id':string(MIGRATION),'sourceChecksum':string(BACKUP_CHECKSUM),'sourceSnapshotChecksum':string(digest(data)),'administrativeAuthorUid':string('migration-admin-v02'),'createdAt':timestamp(stamp),'productCount':integer(37)}}
  writes.append({'update':event,'currentDocument':{'exists':False}})
  plan={'beforeDigest':digest(data),'before':data,'updates':updates,'writes':writes};plan['checksum']=digest(plan);write_private(plan_path,plan)
 validate_writes({'writes':plan['writes']})
 admin.commit(plan['writes'])
 after=snapshot(reader);expected={d['name']:d['fields'] for d in plan['updates']}
 require(len(after['documents'])==38 and all(normalize(d['fields'])==normalize(expected[d['name']]) for d in after['documents'] if d['name'] in expected) and {d['name'] for d in after['documents']}==set(expected)|{doc_path('operations',MIGRATION)},'POST_COMMIT_REVIEW_REQUIRED')
 receipt=admin.get('operations',MIGRATION);require(scalar(receipt['fields'],'sourceChecksum')==BACKUP_CHECKSUM,'RECEIPT_MISSING')
 write_private(folder/('apres-conversion-'+str(time.time_ns())+'.json'),after)
 return {'backendReady':True,'migration':'applied-atomic-38-writes','productCount':37}

def authorize(reader,admin,uid,folder,revoke=False):
 require(valid_uid(uid),'UID_FORMAT')
 require(admin.get('operations',MIGRATION) is not None,'MIGRATION_REQUIRED_FIRST')
 _,rules=rules_current(admin);require(rules_expected(rules),'FINAL_RULES_REQUIRED')
 if not revoke:
  users=admin.request('identitytoolkit.googleapis.com','/v1/projects/'+PROJECT+'/accounts:lookup',{'localId':[uid]},'POST').get('users',[])
  require(len(users)==1 and users[0].get('localId')==uid and not users[0].get('disabled',False) and not users[0].get('providerUserInfo') and not any(users[0].get(k) for k in ('email','phoneNumber','passwordHash','displayName')),'EXISTING_ANONYMOUS_PROFILE_REQUIRED')
 before=admin.get('members',uid);fields=before.get('fields',{}) if before else {}
 if before:require(scalar(fields,'schemaVersion')==2 and scalar(fields,'uid')==uid and scalar(fields,'role')=='device' and scalar(fields,'authType')=='anonymous' and scalar(fields,'status') in ('active','revoked') and type(scalar(fields,'revision')) is int and 1<=scalar(fields,'revision')<2**53-1,'EXISTING_MEMBER_REVIEW_REQUIRED')
 if revoke:require(before is not None,'UNKNOWN_DEVICE')
 if scalar(fields,'status')==('revoked' if revoke else 'active'):return {'member':'unchanged','backendReady':True}
 members=[d for d in snapshot(reader)['documents'] if d['name'].startswith(DOCUMENTS+'/members/')]
 require(revoke or sum(scalar(d['fields'],'status')=='active' for d in members)<3,'THREE_ACTIVE_PROFILES_MAXIMUM')
 stamp=dt.datetime.now(dt.timezone.utc).isoformat().replace('+00:00','Z');operation='device_admin_'+sha((uid+stamp).encode())[:32]
 next_fields={'schemaVersion':integer(2),'uid':string(uid),'role':string('device'),'authType':string('anonymous'),'status':string('revoked' if revoke else 'active'),'label':string(scalar(fields,'label') or ''),'revision':integer((scalar(fields,'revision') or 0)+1),'updatedAt':timestamp(stamp),'lastAdminOperationId':string(operation)}
 write_private(folder/('autorisation-'+str(time.time_ns())+'.json'),{'before':before,'after':next_fields})
 admin.commit([{'update':{'name':doc_path('members',uid),'fields':next_fields},'currentDocument':{'updateTime':before['updateTime']} if before else {'exists':False}}])
 require(normalize(admin.get('members',uid)['fields'])==normalize(next_fields),'MEMBER_READBACK')
 return {'member':'revoked' if revoke else 'authorized','backendReady':True}

def main():
 os.umask(0o077);parser=argparse.ArgumentParser();parser.add_argument('--backup',type=Path,default=Path.home()/'inventaire-sauvegarde-20261113T174004Z-ab70ec/sauvegarde-complete.json');group=parser.add_mutually_exclusive_group();group.add_argument('--autoriser');group.add_argument('--revoquer');args=parser.parse_args()
 report={'format':'inventaire-finalisation-result','version':1,'projectId':PROJECT,'projectNumber':NUMBER,'location':'eur3','status':'STOPPED','backendReady':False};reader=None;admin=None;lock=None
 try:
  load_package();original=read_original(args.backup);folder=args.backup.resolve().parent
  lock=(folder/'finalisation-v02.lock').open('a+')
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise Stop('FINALISATION_ALREADY_RUNNING') from None
  login=subprocess.run(['gcloud','auth','print-access-token','--project='+PROJECT],capture_output=True,text=True,stdin=subprocess.DEVNULL,timeout=45);require(login.returncode==0 and bool(login.stdout.strip()),'GOOGLE_SIGN_IN_REQUIRED');reader=Reader(login.stdout.strip());admin=Admin(reader)
  project_check(reader,admin)
  print('Projet familial vérifié, sans facturation. Ne pas modifier les stocks pendant la bascule.',flush=True)
  result=authorize(reader,admin,args.autoriser or args.revoquer,folder,bool(args.revoquer)) if args.autoriser or args.revoquer else migrate(reader,admin,original,folder)
  report.update(result,status='BACKEND_READY',billingAccountLinked=False)
  print('BACKEND PRET. Sauvegardes privées conservées. Aucun compte Auth créé.',flush=True)
 except (Stop,FileNotFoundError,subprocess.TimeoutExpired) as error:
  report['error']=str(error) if isinstance(error,Stop) else 'FICHIER_OU_CONNEXION_MANQUANT';print('ARRÊT : '+report['error']+'. Ne pas supprimer le dossier de sauvegarde.',flush=True)
 except Exception:
  report['error']='UNEXPECTED_STOP_PRESERVE_PRIVATE_JOURNAL';print('ARRÊT : conserver le journal privé et transmettre uniquement le résultat.',flush=True)
 report['cloudMutationRequests']=admin.writes if admin else 0
 if reader and reader.last_diagnostic:report['diagnostic']=reader.last_diagnostic
 output=Path('inventaire-finalisation-resultat-'+str(time.time_ns())+'.json');write_private(output,report);print('Fichier à transmettre : '+output.name,flush=True)
 if lock:lock.close()
 return 0 if report['backendReady'] else 1
if __name__=='__main__':sys.exit(main())
