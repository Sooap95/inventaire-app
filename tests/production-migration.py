"""Fictitious typed Firestore values only. No Google login or network."""
import copy,importlib.util,sys,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import finaliser_inventaire as m
from unittest.mock import patch
def fixture():
 return {'name':m.doc_path('products','fictional-product-1'),'updateTime':'2020-01-01T00:00:00Z','fields':{
 'id':m.string('fictional-product-1'),'name':m.string('Œufs fictifs'),'unit':m.string('boîte'),
 'stock':{'doubleValue':2.5},'threshold':m.integer(2),'target':m.integer(6),'frequency':m.string(''),
 'lastRestocked':m.string('2020-01-01T10:11:12.123000Z'),
 'barcode':m.string('4006381333931'),'custom':{'mapValue':{'fields':{'legacyExtension':m.string('preserved')}}},
 'restockHistory':{'arrayValue':{'values':[{'mapValue':{'fields':{'qty':m.integer(3)}}}]}}}}
STAMP='2020-01-01T00:00:00.120000Z'
class Tests(unittest.TestCase):
 def test_preserve_all_fields_ids_units_history_and_no_mutation(self):
  before=fixture();saved=copy.deepcopy(before);after=m.convert(before,STAMP);self.assertEqual(saved,before)
  self.assertEqual(after['name'],before['name']);self.assertEqual(after['fields']['legacy']['mapValue']['fields'],before['fields'])
  self.assertEqual(m.scalar(after['fields'],'stockMicros'),2500000);self.assertEqual(m.scalar(after['fields'],'thresholdMicros'),2000000);self.assertEqual(m.scalar(after['fields'],'targetMicros'),6000000)
  self.assertEqual(m.scalar(after['fields'],'unit'),'boîte');self.assertEqual(m.scalar(after['fields'],'revision'),1)
 def test_decimal_comma_exact_no_rounding(self):
  p=fixture();p['fields']['stock']=m.string('2,000001');self.assertEqual(m.scalar(m.convert(p,STAMP)['fields'],'stockMicros'),2000001)
  for value in [-1,1000001,0.0000001,float('nan'),True,None]:
   p=fixture();p['fields']['stock']={'doubleValue':value} if value is not None else {'nullValue':None}
   with self.assertRaises(m.Stop):m.convert(p,STAMP)
 def test_invalid_ids_names_units_frequencies_dates_and_schema_refused(self):
  for key,value in [('id',m.string('wrong')),('name',m.string(' ')),('unit',m.string('')),('frequency',m.string('yearly')),('lastRestocked',m.string('2020-01-01T00:00:00')),('schemaVersion',m.integer(2))]:
   p=fixture();p['fields'][key]=value
   with self.assertRaises(m.Stop):m.convert(p,STAMP)
 def test_batch_exact_cas_and_no_delete_or_partial_commit(self):
  p=fixture();write={'update':m.convert(p,STAMP),'currentDocument':{'updateTime':p['updateTime']}};m.validate_writes({'writes':[write]})
  for change in [{'currentDocument':{}},{'currentDocument':{'exists':True}},{'updateMask':{'fieldPaths':['stockMicros']}},{'delete':p['name']}]:
   with self.assertRaises(m.Stop):m.validate_writes({'writes':[{**write,**change}]})
  with self.assertRaises(m.Stop):m.validate_writes({'writes':[write,write]})
  write['update']['name']=write['update']['name'].replace(m.PROJECT,'another-project')
  with self.assertRaises(m.Stop):m.validate_writes({'writes':[write]})
 def test_timestamp_wire_normalization_preserves_user_fields(self):
  a={'updatedAt':m.timestamp(STAMP),'createTime':m.string('user-data')};b={'updatedAt':m.timestamp('2020-01-01T00:00:00.12Z'),'createTime':m.string('user-data')}
  self.assertEqual(m.normalize(a),m.normalize(b));self.assertIn('createTime',m.normalize(a))
 def test_uid_and_anonymous_members_only(self):
  for uid in ['abc','bad/uid','bad uid','',None]:self.assertFalse(m.valid_uid(uid))
  self.assertTrue(m.valid_uid('fictional-device-uid'))
  fields={'schemaVersion':m.integer(2),'uid':m.string('fictional-device-uid'),'role':m.string('device'),'authType':m.string('anonymous'),'status':m.string('active'),'label':m.string(''),'revision':m.integer(1),'updatedAt':m.timestamp(STAMP),'lastAdminOperationId':m.string('fictional-admin-operation')}
  write={'update':{'name':m.doc_path('members','fictional-device-uid'),'fields':fields},'currentDocument':{'exists':False}}
  m.validate_writes({'writes':[write]});fields['role']=m.string('owner')
  with self.assertRaises(m.Stop):m.validate_writes({'writes':[write]})
 def test_backup_changed_refused(self):
  import tempfile
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/'backup.json';p.write_text('{}')
   with self.assertRaisesRegex(m.Stop,'ORIGINAL_BACKUP_FILE_HASH'):m.read_original(p)
 def test_network_whitelist_refuses_every_unrelated_write(self):
  class Reader:
   class Opener:
    def open(self,*a,**k):raise AssertionError('NO NETWORK ALLOWED')
   opener=Opener();token='fictional-never-used'
  admin=m.Admin(Reader())
  for host,path,method,body in [('cloudbilling.googleapis.com','/v1/projects/'+m.PROJECT+'/billingInfo','PATCH',{}),('firestore.googleapis.com','/v1/projects/other/databases/(default)/documents:commit','POST',{'writes':[]}),('identitytoolkit.googleapis.com','/v1/projects/'+m.PROJECT+'/accounts','POST',{}),('firebaserules.googleapis.com',m.RULE+'/rulesets','POST',{'source':{'files':[]}})]:
   import tempfile
   with tempfile.TemporaryDirectory() as tmp:
    target=Path(tmp);(target/'rules.firestore').write_text((ROOT/'security/firestore.rules').read_text())
    with patch.object(m,'ROOT',target),self.assertRaises(m.Stop):admin.request(host,path,body,method)
 def migration_scenario(self,mode):
  import tempfile,time
  records={}
  for index in range(37):
   doc=fixture();id='fictional-product-'+str(index);doc['name']=m.doc_path('products',id);doc['fields']['id']=m.string(id);records[doc['name']]=doc
  original={'data':{'documents':copy.deepcopy(list(records.values()))}}
  class Admin:
   attempts=0
   def get(self,col,id):return copy.deepcopy(records.get(m.doc_path(col,id)))
   def commit(self,writes):
    self.attempts+=1;m.validate_writes({'writes':writes})
    if mode=='conflict':records[writes[0]['update']['name']]['updateTime']='2021-01-01T00:00:00Z'
    # Validate every precondition before applying any write.
    for w in writes:
     previous=records.get(w['update']['name'])
     if w['currentDocument']=={'exists':False}:m.require(previous is None,'CAS_CONFLICT')
     else:m.require(previous and previous['updateTime']==w['currentDocument']['updateTime'],'CAS_CONFLICT')
    if mode=='network-before' and self.attempts==1:raise m.Stop('NETWORK_UNKNOWN')
    for w in writes:records[w['update']['name']]={**copy.deepcopy(w['update']),'updateTime':'2022-01-01T00:00:00Z'}
    if mode=='network-after' and self.attempts==1:raise m.Stop('NETWORK_UNKNOWN')
  admin=Admin()
  def snapshot(reader):return {'documents':copy.deepcopy(sorted(records.values(),key=lambda d:d['name'])),'collectionPaths':[m.DOCUMENTS+'/products'],'complete':True}
  with tempfile.TemporaryDirectory() as tmp:
   folder=Path(tmp);m.write_private(folder/'journal-finalisation-v02.json',{'originalBackupChecksum':m.BACKUP_CHECKSUM,'createdAt':STAMP});m.write_private(folder/'propagation-regles-v02.json',{'publishedAt':time.time()-100})
   rules={'source':{'files':[{'name':'firestore.rules','content':(ROOT/'security/firestore.rules').read_text()}]}}
   with patch.object(m,'snapshot',snapshot),patch.object(m,'setup_indexes',lambda a,f:None),patch.object(m,'rules_current',lambda a:({},rules)),patch.object(m,'rules_expected',lambda r:r==rules):
    if mode in ('conflict','network-before','network-after'):
     with self.assertRaises(m.Stop):m.migrate(None,admin,original,folder)
    else:self.assertTrue(m.migrate(None,admin,original,folder)['backendReady'])
    if mode=='conflict':
     self.assertEqual(len(records),37);self.assertTrue(all('schemaVersion' not in d['fields'] for d in records.values()));return
    result=m.migrate(None,admin,original,folder);self.assertTrue(result['backendReady']);attempts=admin.attempts
    self.assertEqual(m.migrate(None,admin,original,folder)['migration'],'already-applied-no-write');self.assertEqual(admin.attempts,attempts)
    self.assertEqual(len(records),38)
    for previous in original['data']['documents']:
     after=records[previous['name']]['fields'];self.assertEqual(after['legacy']['mapValue']['fields'],previous['fields']);self.assertEqual(m.scalar(after,'stockMicros'),2500000)
 def test_atomic_migration_and_idempotent_replay(self):self.migration_scenario('normal')
 def test_concurrent_stock_refuses_entire_batch(self):self.migration_scenario('conflict')
 def test_network_before_commit_reuses_same_plan(self):self.migration_scenario('network-before')
 def test_unknown_result_after_commit_never_converts_twice(self):self.migration_scenario('network-after')
 def test_explicit_anonymous_profile_authorization_replay_and_revocation(self):
  import tempfile
  uid='fictional-device-uid';records={};anonymous={'localId':uid};calls=[]
  class Admin:
   def get(self,col,id):return {'fields':{'sourceChecksum':m.string(m.BACKUP_CHECKSUM)}} if col=='operations' else copy.deepcopy(records.get(id))
   def request(self,host,path,body,method):calls.append((host,path,body,method));return {'users':[anonymous]}
   def commit(self,writes):
    m.validate_writes({'writes':writes});w=writes[0];records[uid]={**copy.deepcopy(w['update']),'updateTime':'2022-01-01T00:00:00Z'}
  admin=Admin()
  with tempfile.TemporaryDirectory() as tmp,patch.object(m,'snapshot',lambda r:{'documents':[{'name':m.doc_path('members',k),'fields':v['fields']} for k,v in records.items()]}),patch.object(m,'rules_current',lambda a:({},{})),patch.object(m,'rules_expected',lambda r:True):
   folder=Path(tmp);self.assertEqual(m.authorize(None,admin,uid,folder)['member'],'authorized');self.assertEqual(m.authorize(None,admin,uid,folder)['member'],'unchanged')
   self.assertEqual(m.authorize(None,admin,uid,folder,True)['member'],'revoked')
   anonymous['email']='fictional@example.invalid'
   with self.assertRaisesRegex(m.Stop,'EXISTING_ANONYMOUS_PROFILE_REQUIRED'):m.authorize(None,admin,uid,folder)
   self.assertEqual(m.scalar(records[uid]['fields'],'status'),'revoked')
  self.assertTrue(all(call[1].endswith('/accounts:lookup') for call in calls))
 def test_packaged_launcher_help_without_login_or_overwrite(self):
  import tempfile,runpy,contextlib,io
  from package_production_admin import build
  with contextlib.redirect_stdout(io.StringIO()):build()
  artifact=ROOT/'artifacts/finaliser_inventaire_v02.py'
  with tempfile.TemporaryDirectory() as tmp,patch.object(Path,'home',return_value=Path(tmp)),patch.object(sys,'argv',[str(artifact),'--help']),patch.object(m.subprocess,'run',side_effect=AssertionError('NO LOGIN OR NETWORK')),contextlib.redirect_stdout(io.StringIO()):
   with self.assertRaises(SystemExit) as result:runpy.run_path(str(artifact),run_name='__main__')
   self.assertEqual(result.exception.code,0);folders=list(Path(tmp).glob('inventaire-finalisation-*'));self.assertEqual(len(folders),1)
   target=folders[0]/'rules.firestore';self.assertEqual(target.stat().st_mode&0o777,0o600);target.write_text('LOCAL CHANGE')
   with self.assertRaises(SystemExit):runpy.run_path(str(artifact),run_name='__main__')
   self.assertEqual(target.read_text(),'LOCAL CHANGE')
if __name__=='__main__':unittest.main()
