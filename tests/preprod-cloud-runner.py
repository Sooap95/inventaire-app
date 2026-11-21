import importlib.util,json,sys,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import preprod_cloud_shell as runner

class CloudTests(unittest.TestCase):
 def test_seed_uses_exact_ids_and_firestore_types(self):
  seed=json.loads((ROOT/'config/preprod/seed-a2s-four-products.json').read_text())
  docs=[runner.document(e) for e in seed['documents']]
  self.assertEqual([d['name'].rsplit('/',1)[-1] for d in docs],['milk','butter','aptamil','eggs'])
  self.assertTrue(all(d['name'].startswith(runner.DB+'/documents/products/') for d in docs))
  self.assertEqual(docs[0]['fields']['stockMicros'],{'integerValue':'1000000'})
  self.assertEqual(docs[0]['fields']['updatedAt'],{'timestampValue':'2026-11-10T00:00:00Z'})
  self.assertEqual(runner.sha(runner.canonical(seed['documents'])),'21408dc716aa58e93b2f91df1e48104b3006b3042104b9017b03edcbc7df7c5f')
 def test_admin_rejects_other_project_and_members(self):
  admin=runner.Admin(type('Reader',(),{'token':'FICTIONAL'})())
  for host,path,body in [('firestore.googleapis.com','/v1/projects/other/databases/(default)/documents:commit',{}),('identitytoolkit.googleapis.com','/v1/projects/'+runner.PROJECT+'/accounts',{}),('firestore.googleapis.com','/v1/'+runner.DB+'/documents/members/fake',{})]:
   with self.assertRaisesRegex(RuntimeError,'ADMIN_OPERATION_REFUSED'):admin.send(host,path,body)
 def test_seed_commit_cannot_write_members_even_at_commit_endpoint(self):
  admin=runner.Admin(type('Reader',(),{'token':'FICTIONAL'})())
  with patch.object(runner,'load',return_value={'documents':[]}):
   with self.assertRaisesRegex(RuntimeError,'COMMIT_NOT_APPROVED_SEED'):admin.send('firestore.googleapis.com','/v1/'+runner.DB+'/documents:commit',{'writes':[{'delete':runner.DB+'/documents/products/milk'}]})
 def test_unchanged_seed_is_noop_and_changed_seed_refused(self):
  entries=json.loads((ROOT/'config/preprod/seed-a2s-four-products.json').read_text())['documents']
  class Reader:
   def read(self,host,path,body=None):return {'collectionIds':['products']} if body else {'documents':[runner.document(e) for e in entries]}
  self.assertEqual(runner.seed_state(Reader(),entries),'identical')
  changed=json.loads(json.dumps(entries));changed[0]['data']['stockMicros']=2000000
  with self.assertRaisesRegex(RuntimeError,'SEED_CONFLICT_NO_OVERWRITE'):runner.seed_state(Reader(),changed)
 def test_unexpected_collection_stops_without_reading_documents(self):
  class Reader:
   def read(self,host,path,body=None):return {'collectionIds':['products','other']}
  with self.assertRaisesRegex(RuntimeError,'DATABASE_NOT_EMPTY'):runner.seed_state(Reader(),[])
 def test_unverified_preflight_cannot_write(self):
  with self.assertRaisesRegex(RuntimeError,'PREFLIGHT_UNVERIFIED'):runner.check_initial({'billing':{'status':'UNVERIFIED'}},{},{})
 def test_unknown_package_digest_is_refused(self):
  import tempfile
  with tempfile.TemporaryDirectory() as d:
   Path(d,'lot-manifest.json').write_text('{}')
   with patch.object(runner,'ROOT',Path(d)):
    with self.assertRaisesRegex(RuntimeError,'LOT_MANIFEST_HASH'):runner.package('0'*64)
 def test_preflight_error_sends_no_administrative_request(self):
  from unittest.mock import Mock
  admin=Mock()
  with patch.object(runner,'load',side_effect=lambda f:{'indexes':[]} if f=='indexes.json' else {'documents':[]}):
   with patch.object(runner,'inspect',return_value={'billing':{'status':'UNVERIFIED'}}):
    with self.assertRaisesRegex(RuntimeError,'PREFLIGHT_UNVERIFIED'):runner.apply(Mock(),admin,{}, {})
  admin.send.assert_not_called()
 def test_full_apply_atomic_seed_idempotence_and_deny_all_rollback(self):
  import tempfile,copy
  entries=json.loads((ROOT/'config/preprod/seed-a2s-four-products.json').read_text())['documents']
  spec=json.loads((ROOT/'security/firestore.indexes.json').read_text())
  old='INITIAL_FICTIONAL_DENY';new='APPROVED_FICTIONAL_RULES'
  old_name='projects/'+runner.PROJECT+'/rulesets/initial';new_name='projects/'+runner.PROJECT+'/rulesets/approved'
  class Backend:
   def __init__(self):self.release=old_name;self.products=[];self.indexes=[];self.fields=[];self.calls=[]
   def read(self,host,path,body=None):
    if body is not None:return {'collectionIds':['products'] if self.products else []}
    if path.endswith('/releases/cloud.firestore'):return {'rulesetName':self.release}
    if '/rulesets/' in path:return {'source':{'files':[{'content':old if path.endswith('/initial') else new}]}}
    if '/documents/products' in path:return {'documents':copy.deepcopy(self.products)}
    raise AssertionError('Unexpected fictional read')
   def pages(self,host,path,key):return copy.deepcopy(self.indexes)
   def send(self,host,path,body,method='POST'):
    self.calls.append((host,path,body,method))
    if path.endswith(':testIamPermissions'):return {'permissions':runner.PERMISSIONS}
    assert list(runner.ROOT.glob('backup-before-*.json')),'Write before verified backup'
    if path.endswith('/rulesets'):return {'name':new_name}
    if path.endswith('/releases/cloud.firestore'):
     assert set(body)=={'release'};self.release=body['release']['rulesetName'];return {}
    if path.endswith('/indexes'):
     self.indexes=[dict(body,name=runner.DB+'/collectionGroups/operations/indexes/fake',state='READY')];return {}
    if '/fields/' in path:self.fields.append(dict(body,name=path[4:].split('?')[0]));return {}
    if path.endswith('/documents:commit'):
     assert len(body['writes'])==4 and all(w['currentDocument']=={'exists':False} for w in body['writes'])
     assert not self.products;self.products=[w['update'] for w in body['writes']];return {}
    raise AssertionError('Unexpected fictional operation')
  backend=Backend()
  manifest={'initialRulesSourceSha256':runner.sha(old.encode()),'files':{'rules.firestore':runner.sha(new.encode())},'publicApiKeySha256':'FICTITIOUS_HASH'}
  def inspect(reader):
   values={'project':{'projectId':runner.PROJECT,'projectNumber':runner.NUMBER,'state':'ACTIVE'},'billing':{'billingEnabled':False,'billingAccountLinked':False},'database':{'name':runner.DB,'locationId':'europe-west6','freeTier':True,'databaseEdition':'STANDARD'},'rules':{'sourceSha256':[runner.sha((old if backend.release==old_name else new).encode())]},'indexes':copy.deepcopy(backend.indexes),'fieldOverrides':copy.deepcopy(backend.fields),'collections':{'complete':True,'rootCollectionCount':1 if backend.products else 0},'auth':{'anonymous':True,'email':False,'phoneNumber':False},'defaultSupportedIdpConfigs':[],'oauthIdpConfigs':[],'inboundSamlConfigs':[],'authUsers':{'count':0},'webApps':[{'appId':runner.APP,'state':'ACTIVE'}],'webConfiguration':{'projectId':runner.PROJECT,'appId':runner.APP,'apiKeySha256':'FICTITIOUS_HASH','authDomain':runner.PROJECT+'.firebaseapp.com','messagingSenderId':runner.NUMBER}}
   return {k:{'status':'READ','value':v} for k,v in values.items()}
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)
   for f,data in [('indexes.json',spec),('seed.json',{'documents':entries}),('approval.json',{'initialRulesetName':old_name,'initialRulesSourceSha256':runner.sha(old.encode())})]:Path(p,f).write_text(json.dumps(data))
   Path(p,'rules.firestore').write_text(new)
   with patch.object(runner,'ROOT',p),patch.object(runner,'inspect',side_effect=inspect):
    report={};runner.apply(backend,backend,manifest,report)
    self.assertTrue(report['backendReady']);self.assertEqual(report['seed'],'created')
    first=len(backend.calls);again={};runner.apply(backend,backend,manifest,again)
    self.assertEqual(again['seed'],'identical-no-op')
    self.assertTrue(all(call[1].endswith(':testIamPermissions') for call in backend.calls[first:]))
    backup=json.loads(Path(p,report['backupFile']).read_text())
    runner.rollback(backend,backend,backup,manifest)
    self.assertEqual(backend.release,old_name);self.assertEqual(len(backend.products),4)
if __name__=='__main__':unittest.main()
