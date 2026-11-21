#!/usr/bin/env python3
"""A3 private administrative tool: one selected anonymous profile, two slots maximum."""
import argparse,hashlib,json,os,re,subprocess,time,uuid,getpass
from pathlib import Path
import urllib.request,urllib.error
from check_preprod_cloud_shell import Reader,NoRedirect,ReadFailure,inspect,PROJECT,NUMBER,APP

ROOT=Path(__file__).resolve().parent
DB=f'projects/{PROJECT}/databases/(default)'
BASE='/v1/'+DB+'/documents'
CORE={'schemaVersion','uid','role','authType','status','label','revision','lastAdminOperationId','updatedAt'}
def require(ok,code):
 if not ok:raise RuntimeError(code)
def canonical(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def sha(x):return hashlib.sha256(x).hexdigest()
def valid_uid(uid):return isinstance(uid,str) and bool(re.fullmatch(r'[A-Za-z0-9_-]{1,128}',uid))
def encode(x):
 if isinstance(x,int):return {'integerValue':str(x)}
 if isinstance(x,str):return {'stringValue':x}
 raise RuntimeError('MEMBER_FIELD_TYPE')
def decode(doc):
 fields=doc.get('fields',{});require(set(fields)==CORE,'MEMBER_SCHEMA_UNEXPECTED')
 data={k:(int(v['integerValue']) if 'integerValue' in v else v.get('stringValue')) for k,v in fields.items() if k!='updatedAt'}
 uid=data.get('uid');require(valid_uid(uid) and doc.get('name')==DB+'/documents/members/'+uid,'MEMBER_TARGET')
 require(data['schemaVersion']==2 and data['role']=='device' and data['authType']=='anonymous' and data['status'] in ['active','revoked'],'MEMBER_ROLE_UNEXPECTED')
 require(data['label'] in ['Profil A','Profil B'] and isinstance(data['revision'],int) and data['revision']>0 and isinstance(data['lastAdminOperationId'],str) and doc.get('updateTime'),'MEMBER_REVISION_UNEXPECTED')
 require(bool(data['lastAdminOperationId']) and set(fields['updatedAt'])=={'timestampValue'} and isinstance(fields['updatedAt']['timestampValue'],str),'MEMBER_TIMESTAMP_UNEXPECTED')
 return data
def check_members(docs):
 require(len(docs)<=2,'TOO_MANY_MEMBERS')
 values=[decode(d) for d in docs]
 require(len({v['uid'] for v in values})==len(values) and len({v['label'] for v in values})==len(values),'MEMBER_SLOT_CONFLICT')
 return values


class Client:
 def __init__(self,token):self.reader=Reader(token)
 def call(self,host,path,body):
  lookup=host=='identitytoolkit.googleapis.com' and path==f'/v1/projects/{PROJECT}/accounts:lookup?fields=users(localId,disabled,customAuth,providerUserInfo(providerId))'
  tx=host=='firestore.googleapis.com' and path in [BASE+':beginTransaction',BASE+':runQuery',BASE+':commit',BASE+':rollback']
  require(lookup or tx,'A3_OPERATION_REFUSED')
  if lookup:require(set(body)=={'localId'} and len(body['localId'])==1 and valid_uid(body['localId'][0]),'AUTH_LOOKUP_SCOPE')
  if path.endswith(':beginTransaction'):require(body=={'options':{'readWrite':{}}},'TRANSACTION_OPTIONS')
  if path.endswith(':runQuery'):require(body.get('structuredQuery')=={'from':[{'collectionId':'members'}],'limit':3} and set(body)=={'structuredQuery','transaction'} and bool(body['transaction']),'QUERY_SCOPE')
  if path.endswith(':rollback'):require(set(body)=={'transaction'} and bool(body['transaction']),'ROLLBACK_SCOPE')
  if path.endswith(':commit'):
   require(set(body)=={'writes','transaction'} and bool(body['transaction']) and len(body['writes'])==1,'MEMBER_COMMIT_SCOPE')
   write=body['writes'][0];require(set(write)=={'update','updateTransforms','currentDocument'},'MEMBER_WRITE_SCOPE')
   require(write['updateTransforms']==[{'fieldPath':'updatedAt','setToServerValue':'REQUEST_TIME'}],'MEMBER_TRANSFORMS')
   fields=write['update'].get('fields',{});require(set(fields)==CORE-{'updatedAt'},'MEMBER_FIELD_SET')
   decode({'name':write['update'].get('name'),'updateTime':'checked-by-precondition','fields':fields|{'updatedAt':{'timestampValue':'2000-01-01T00:00:00Z'}}})
   require(write['currentDocument']=={'exists':False} or (set(write['currentDocument'])=={'updateTime'} and isinstance(write['currentDocument']['updateTime'],str)),'MEMBER_PRECONDITION')
  req=urllib.request.Request('https://'+host+path,data=json.dumps(body).encode(),method='POST',headers={'Authorization':'Bearer '+self.reader.token,'Content-Type':'application/json'})
  try:
   with urllib.request.build_opener(NoRedirect).open(req,timeout=40) as r:return json.load(r)
  except urllib.error.HTTPError as e:raise ReadFailure('HTTP_'+str(e.code)) from None
  except (urllib.error.URLError,TimeoutError):raise RuntimeError('NETWORK_ERROR_NO_AUTOMATIC_WRITE_RETRY') from None
 def members(self,transaction=None):
  if transaction:
   data=self.call('firestore.googleapis.com',BASE+':runQuery',{'structuredQuery':{'from':[{'collectionId':'members'}],'limit':3},'transaction':transaction})
   docs=[row['document'] for row in data if 'document' in row]
  else:
   data=self.reader.read('firestore.googleapis.com',BASE+'/members?pageSize=3')
   require(not data.get('nextPageToken'),'MEMBER_LIST_INCOMPLETE');docs=data.get('documents',[])
  check_members(docs);return sorted(docs,key=lambda d:d['name'])
 def anonymous(self,uid):
  result=self.call('identitytoolkit.googleapis.com',f'/v1/projects/{PROJECT}/accounts:lookup?fields=users(localId,disabled,customAuth,providerUserInfo(providerId))',{'localId':[uid]})
  users=result.get('users',[])
  require(len(users)==1 and users[0].get('localId')==uid and not users[0].get('disabled') and not users[0].get('customAuth') and not users[0].get('providerUserInfo'),'EXISTING_ANONYMOUS_PROFILE_REQUIRED')


def preflight(client,approval,require_fixtures=True):
 checks=inspect(client.reader)
 required=['project','billing','database','rules','indexes','fieldOverrides','auth','defaultSupportedIdpConfigs','oauthIdpConfigs','inboundSamlConfigs','authUsers','webApps','webConfiguration']
 failed=[{'check':k,'error':checks.get(k,{}).get('error','NOT_READ')} for k in required if checks.get(k,{}).get('status')!='READ']
 if failed:raise ReadFailure('A3_PREFLIGHT_UNVERIFIED',{'checks':failed})
 v=lambda key:checks[key]['value']
 require(v('project')=={'projectId':PROJECT,'projectNumber':NUMBER,'state':'ACTIVE'},'A3_PROJECT_CHANGED')
 require(v('billing')=={'billingEnabled':False,'billingAccountLinked':False},'A3_BILLING_NOT_FREE')
 db=v('database');require(db['name']==DB and db['locationId']=='europe-west6' and db['freeTier'] is True and db['databaseEdition']=='STANDARD','A3_DATABASE_CHANGED')
 require(v('rules')['sourceSha256']==[approval['rulesSha256']],'A2_BACKEND_RULES_NOT_READY')
 require(v('auth')=={'anonymous':True,'email':False,'phoneNumber':False} and all(not v(k) for k in ['defaultSupportedIdpConfigs','oauthIdpConfigs','inboundSamlConfigs']),'A3_AUTH_PROVIDER_CHANGED')
 require(v('authUsers')['count']<=2,'UNEXPECTED_AUTH_ACCOUNT_COUNT')
 config=v('webConfiguration');require(v('webApps')==[{'appId':APP,'state':'ACTIVE'}] and config['apiKeySha256']==approval['publicApiKeySha256'] and config['projectId']==PROJECT and config['appId']==APP and config['messagingSenderId']==NUMBER and config['authDomain']==PROJECT+'.firebaseapp.com','A3_WEB_APP_CHANGED')
 indexes=v('indexes');require(len(indexes)==1 and indexes[0]['state']=='READY' and indexes[0]['name'].startswith(DB+'/collectionGroups/operations/indexes/'),'A2_INDEX_NOT_READY')
 fields=[{k:f[k] for k in ['fieldPath','order'] if k in f} for f in indexes[0]['fields'] if f['fieldPath']!='__name__']
 require(indexes[0]['queryScope']=='COLLECTION' and fields==[{'fieldPath':'targetId','order':'ASCENDING'},{'fieldPath':'createdAt','order':'DESCENDING'}],'A3_INDEX_CHANGED')
 expected={('products','legacy'),('shoppingLines','contributions'),('shoppingLines','checks'),('operations','after'),('operations','receipt')};actual=set()
 for field in v('fieldOverrides'):
  require(not field.get('ttlConfig'),'A3_TTL_UNEXPECTED')
  name=field.get('name','')
  if name.endswith('/fields/__default__'):continue
  require(name.startswith(DB+'/collectionGroups/'),'A3_FIELD_TARGET')
  parts=name[len(DB+'/collectionGroups/'):].split('/fields/');require(len(parts)==2 and not field.get('indexConfig',{}).get('indexes'),'A3_FIELD_CHANGED');actual.add(tuple(parts))
 require(actual==expected,'A2_FIELD_OVERRIDES_NOT_READY')
 if require_fixtures:
  collections=client.reader.read('firestore.googleapis.com',BASE+':listCollectionIds',{'pageSize':10})
  require(not collections.get('nextPageToken') and 'products' in collections.get('collectionIds',[]) and set(collections.get('collectionIds',[]))<={'products','shoppingLines','operations','members'},'A3_COLLECTION_UNEXPECTED')
  mask='&'.join('mask.fieldPaths='+key for key in ['id','schemaVersion','name','unit','stockMicros','legacy.fixture'])
  products=client.reader.read('firestore.googleapis.com',BASE+'/products?pageSize=5&'+mask)
  require(not products.get('nextPageToken') and len(products.get('documents',[]))==4,'A2_FOUR_FIXTURES_NOT_READY')
  expected={'milk':('Lait','L'),'butter':('Beurre','article'),'aptamil':('Aptamil','boîte'),'eggs':('œufs','boîte')};seen=set()
  for doc in products['documents']:
   f=doc.get('fields',{});id=f.get('id',{}).get('stringValue');require(id in expected and doc.get('name')==DB+'/documents/products/'+id,'A3_FIXTURE_ID')
   require((f.get('name',{}).get('stringValue'),f.get('unit',{}).get('stringValue'))==expected[id] and f.get('schemaVersion',{}).get('integerValue')=='2','A3_FIXTURE_SCHEMA')
   require(f.get('legacy',{}).get('mapValue',{}).get('fields',{}).get('fixture',{}).get('booleanValue') is True,'A3_NOT_FICTITIOUS')
   require(0<=int(f.get('stockMicros',{}).get('integerValue','-1'))<=1000000000000,'A3_FIXTURE_STOCK')
   seen.add(id)
  require(seen==set(expected),'A3_FIXTURE_SET')
 return {'projectConfirmed':True,'freeTierConfirmed':True,'rulesConfirmed':True,'indexesConfirmed':True,'fourFixturesConfirmed':require_fixtures,'authUserCount':v('authUsers')['count']}


def make_plan(docs,uid,slot,action):
 require(valid_uid(uid) and slot in ['A','B'] and action in ['allow','revoke'],'PLAN_INPUT')
 values=check_members(docs);current=next((d for d in docs if decode(d)['uid']==uid),None)
 label='Profil '+slot
 require(not any(v['label']==label and v['uid']!=uid for v in values),'SLOT_ALREADY_USED')
 if action=='revoke':require(current is not None,'UNKNOWN_PROFILE')
 if current:require(decode(current)['label']==label,'PROFILE_SLOT_MISMATCH')
 status='active' if action=='allow' else 'revoked'
 if current and decode(current)['status']==status:return None
 require(current is not None or len(docs)<2,'TWO_PROFILES_MAXIMUM')
 operation='a3-device-'+uuid.uuid4().hex
 data={'schemaVersion':2,'uid':uid,'role':'device','authType':'anonymous','status':status,'label':label,'revision':decode(current)['revision']+1 if current else 1,'lastAdminOperationId':operation}
 plan={'format':'inventaire-a3-member-plan','version':1,'projectId':PROJECT,'projectNumber':NUMBER,'confirmed':False,'action':action,'slot':slot,'uid':uid,'operationId':operation,'before':docs,'next':data,'currentDocument':{'updateTime':current['updateTime']} if current else {'exists':False}}
 return plan|{'checksum':sha(canonical(plan))}


def confirm_plan(plan):
 require(plan['checksum']==sha(canonical({k:v for k,v in plan.items() if k!='checksum'})),'PLAN_CHECKSUM')
 data={k:v for k,v in plan.items() if k!='checksum'};data['confirmed']=True
 return data|{'checksum':sha(canonical(data))}


def apply_plan(client,approval,plan):
 checksum=plan.get('checksum');payload={k:v for k,v in plan.items() if k!='checksum'}
 require(checksum==sha(canonical(payload)) and plan.get('projectId')==PROJECT and plan.get('projectNumber')==NUMBER,'PLAN_CHECKSUM_OR_TARGET')
 require(plan.get('format')=='inventaire-a3-member-plan' and plan.get('version')==1,'PLAN_FORMAT')
 require(plan.get('confirmed') is True,'PLAN_NOT_CONFIRMED')
 require(plan.get('slot') in approval.get('enabledSlots',[]),'PROFILE_SLOT_NOT_ENABLED')
 require(isinstance(plan.get('operationId'),str) and bool(re.fullmatch(r'a3-device-[a-f0-9]{32}',plan['operationId'])),'PLAN_OPERATION_ID')
 before=plan['before'];rebuilt=make_plan(before,plan['uid'],plan['slot'],plan['action'])
 require(rebuilt is not None,'PLAN_ALREADY_NOOP')
 expected=rebuilt['next']|{'lastAdminOperationId':plan['operationId']}
 require(plan['next']==expected and plan['currentDocument']==rebuilt['currentDocument'],'PLAN_FIELDS_CHANGED')
 validation=preflight(client,approval,require_fixtures=plan['action']=='allow')
 if plan['action']=='allow':client.anonymous(plan['uid'])
 tx=client.call('firestore.googleapis.com',BASE+':beginTransaction',{'options':{'readWrite':{}}})['transaction']
 committed=False
 try:
  docs=client.members(tx);current=next((d for d in docs if decode(d)['uid']==plan['uid']),None)
  if current:
   value=decode(current)
   if value.get('lastAdminOperationId')==plan['operationId']:
    require(value==plan['next'],'MEMBER_REPLAY_CONFLICT');return {'replayed':True,'preflight':validation}
  require(canonical(docs)==canonical(before),'MEMBER_CONCURRENT_CHANGE_NEW_PLAN_REQUIRED')
  write={'update':{'name':DB+'/documents/members/'+plan['uid'],'fields':{k:encode(v) for k,v in plan['next'].items()}},'updateTransforms':[{'fieldPath':'updatedAt','setToServerValue':'REQUEST_TIME'}],'currentDocument':plan['currentDocument']}
  client.call('firestore.googleapis.com',BASE+':commit',{'writes':[write],'transaction':tx});committed=True
  after=client.members();row=next((decode(d) for d in after if decode(d)['uid']==plan['uid']),None);require(row==plan['next'],'MEMBER_POST_WRITE_VERIFICATION')
  return {'replayed':False,'preflight':validation,'activeProfiles':sum(decode(d)['status']=='active' for d in after)}
 finally:
  if not committed:
   try:client.call('firestore.googleapis.com',BASE+':rollback',{'transaction':tx})
   except Exception:pass


def load_approval(expected):
 raw=(ROOT/'manifest-a3.json').read_bytes();require(sha(raw)==expected,'A3_PACKAGE_HASH');manifest=json.loads(raw)
 require(manifest.get('projectId')==PROJECT and manifest.get('projectNumber')==NUMBER and manifest.get('scope')=='A3','A3_PACKAGE_SCOPE')
 require(set(manifest['files'])=={'preprod_devices.py','check_preprod_cloud_shell.py','autorisation-a3.json'},'A3_PACKAGE_FILES')
 for name,digest in manifest['files'].items():require(sha((ROOT/name).read_bytes())==digest,'A3_PACKAGE_CHANGED')
 a=json.loads((ROOT/'autorisation-a3.json').read_text());require(a['A3Authorized'] is True and a['maxProfiles']==2 and a['enabledSlots'] in [['A'],['A','B']] and a['projectId']==PROJECT and a['projectNumber']==NUMBER and a['databaseId']=='(default)' and a['location']=='europe-west6' and a['costTargetCHF']==0,'A3_APPROVAL_SCOPE')
 return a


def main():
 os.umask(0o077);parser=argparse.ArgumentParser();parser.add_argument('--package-sha',required=True);parser.add_argument('--resume');args=parser.parse_args();approval=load_approval(args.package_sha)
 result={'format':'inventaire-a3-member-result','projectId':PROJECT,'personalIdentifiersExported':False,'productWrites':0,'authAccountsCreatedByTool':0,'applied':False}
 try:
  token=subprocess.run(['gcloud','auth','print-access-token','--project='+PROJECT],capture_output=True,text=True,timeout=45);require(token.returncode==0 and token.stdout.strip(),'NORMAL_GOOGLE_LOGIN_REQUIRED');client=Client(token.stdout.strip())
  result['preflight']=preflight(client,approval,require_fixtures=False)
  if args.resume:
   path=(ROOT/args.resume).resolve();require(path.parent==ROOT and path.name.startswith('plan-a3-'),'PLAN_PATH');plan=json.loads(path.read_text())
  else:
   action=input('1 = autoriser ; 2 = revoquer [1] : ').strip() or '1';require(action in ['1','2'],'ACTION_REQUIRED');action='allow' if action=='1' else 'revoke'
   slot=input('Profil A (iPhone) ou B (second appareil) [A] : ').strip().upper() or 'A';require(slot in approval['enabledSlots'],'PROFILE_SLOT_NOT_ENABLED');docs=client.members()
   if action=='allow':
    uid=getpass.getpass('Identifiant du profil a AUTORISER (coller ; saisie masquee) : ').strip();require(valid_uid(uid),'UID_FORMAT');client.anonymous(uid)
   else:
    matches=[decode(d) for d in docs if decode(d)['label']=='Profil '+slot];require(len(matches)==1,'SLOT_NOT_FOUND');uid=matches[0]['uid']
   plan=make_plan(docs,uid,slot,action)
   if plan is None:result['preflight']=preflight(client,approval,require_fixtures=action=='allow');print('Etat deja conforme : aucune ecriture.');result.update({'applied':True,'noOp':True,'slot':slot});plan=None
   else:
    path=ROOT/('plan-a3-'+uuid.uuid4().hex+'.json');path.write_text(json.dumps(plan,indent=2)+'\n')
    print('Profil '+slot+' / identifiant finissant par '+uid[-6:]+' -> '+plan['next']['status'])
    require(input('Confirmer cette autorisation/revocation : taper CONFIRMER : ').strip()=='CONFIRMER','CANCELLED_NO_WRITE')
    plan=confirm_plan(plan);path.write_text(json.dumps(plan,indent=2)+'\n')
    print('Plan prive conserve : '+path.name)
  if plan is not None:result.update(apply_plan(client,approval,plan));result.update({'applied':True,'slot':plan['slot'],'status':plan['next']['status']})
 except Exception as e:
  text=str(e);result['error']=text if re.fullmatch(r'[A-Z_0-9]+',text) else 'A3_OPERATION_FAILED_NO_AUTOMATIC_RETRY'
  if isinstance(e,ReadFailure) and e.details:result['diagnostic']=e.details
 path=ROOT/('resultat-a3-'+str(time.time_ns())+'.json');path.write_text(json.dumps(result,indent=2)+'\n');print('Resultat sans identifiants : '+path.name)
 if not result['applied']:raise SystemExit('ARRET : '+result.get('error','NON_CONFIRME'))
 print('TERMINE. Aucun produit ni stock modifie. Le profil peut reessayer sa connexion.')
if __name__=='__main__':main()
