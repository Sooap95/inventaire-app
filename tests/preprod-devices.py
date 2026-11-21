import copy,json,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import preprod_devices as a

def row(uid='fictional_phone_a',slot='A',status='active',revision=1,operation='previous'):
 fields={'schemaVersion':2,'uid':uid,'role':'device','authType':'anonymous','status':status,'label':'Profil '+slot,'revision':revision,'lastAdminOperationId':operation}
 return {'name':a.DB+'/documents/members/'+uid,'fields':{k:a.encode(v) for k,v in fields.items()}|{'updatedAt':{'timestampValue':'2026-01-01T00:00:00Z'}},'updateTime':'2026-01-01T00:00:00Z'}

def plan(*args):
 p=a.make_plan(*args)
 return a.confirm_plan(p) if p is not None else None

class Backend:
 def __init__(self,rows=None):self.rows=rows or [];self.calls=[];self.commits=0;self.anonymous_uids=[]
 def anonymous(self,uid):self.anonymous_uids.append(uid)
 def members(self,tx=None):return copy.deepcopy(self.rows)
 def call(self,host,path,body):
  self.calls.append((path,copy.deepcopy(body)))
  if path.endswith(':beginTransaction'):return {'transaction':'FICTIONAL_TRANSACTION'}
  if path.endswith(':rollback'):return {}
  if path.endswith(':commit'):
   self.commits+=1;write=body['writes'][0];uid=write['update']['fields']['uid']['stringValue']
   previous=next((r for r in self.rows if a.decode(r)['uid']==uid),None)
   if previous and write['currentDocument']!={'updateTime':previous['updateTime']}:raise RuntimeError('HTTP_409')
   value=write['update']|{'updateTime':'2026-02-01T00:00:00Z'};value['fields']=value['fields']|{'updatedAt':{'timestampValue':'2026-02-01T00:00:00Z'}}
   self.rows=[r for r in self.rows if a.decode(r)['uid']!=uid]+[value];return {}
  raise AssertionError('Unapproved fake call')

class Tests(unittest.TestCase):
 def apply(self,b,p):
  with patch.object(a,'preflight',return_value={'fourFixturesConfirmed':True}):return a.apply_plan(b,{'enabledSlots':['A','B']},p)
 def test_uid_paths_and_duplicate_slots_rejected(self):
  for uid in ['a/b','..','a?key','',None]:
   with self.assertRaises(RuntimeError):plan([],uid,'A','allow')
  with self.assertRaisesRegex(RuntimeError,'SLOT_ALREADY_USED'):plan([row()], 'other_phone','A','allow')
 def test_initial_plan_one_member_no_product_write(self):
  p=plan([],'fictional_phone_a','A','allow');b=Backend();r=self.apply(b,p)
  self.assertFalse(r['replayed']);self.assertEqual(b.commits,1)
  commit=next(body for path,body in b.calls if path.endswith(':commit'))
  self.assertEqual(len(commit['writes']),1);self.assertIn('/members/',commit['writes'][0]['update']['name']);self.assertEqual(commit['writes'][0]['currentDocument'],{'exists':False})
 def test_unknown_policy_or_preflight_failure_has_no_transaction(self):
  p=plan([],'fictional_phone_a','A','allow');b=Backend()
  with patch.object(a,'preflight',side_effect=RuntimeError('A2_BACKEND_RULES_NOT_READY')):
   with self.assertRaisesRegex(RuntimeError,'A2_BACKEND_RULES_NOT_READY'):a.apply_plan(b,{'enabledSlots':['A','B']},p)
  self.assertEqual(b.calls,[])
 def test_replay_no_second_commit(self):
  p=plan([],'fictional_phone_a','A','allow');b=Backend();self.apply(b,p)
  self.assertTrue(self.apply(b,p)['replayed']);self.assertEqual(b.commits,1)
 def test_noop_existing_state(self):
  self.assertIsNone(plan([row()],'fictional_phone_a','A','allow'))
  self.assertIsNone(plan([row(status='revoked')],'fictional_phone_a','A','revoke'))
 def test_revoke_and_old_allow_replay_cannot_reactivate(self):
  b=Backend();allow=plan([],'fictional_phone_a','A','allow');self.apply(b,allow)
  revoke=plan(b.members(),'fictional_phone_a','A','revoke');self.apply(b,revoke)
  self.assertEqual(a.decode(b.rows[0])['status'],'revoked');self.assertEqual(a.decode(b.rows[0])['revision'],2)
  with self.assertRaisesRegex(RuntimeError,'MEMBER_CONCURRENT_CHANGE'):self.apply(b,allow)
  self.assertEqual(b.commits,2)
 def test_concurrent_decision_refused_without_overwrite(self):
  b=Backend([row()]);p=plan(b.members(),'fictional_phone_a','A','revoke');b.rows[0]['updateTime']='different'
  with self.assertRaisesRegex(RuntimeError,'MEMBER_CONCURRENT_CHANGE'):self.apply(b,p)
  self.assertEqual(b.commits,0)
 def test_tampered_plan_refused(self):
  p=plan([],'fictional_phone_a','A','allow');p['next']['role']='owner'
  with self.assertRaisesRegex(RuntimeError,'PLAN_CHECKSUM'):self.apply(Backend(),p)
 def test_recalculated_checksum_cannot_change_role_or_revision(self):
  for field,value in [('role','owner'),('revision',30),('uid','other_phone')]:
   p=plan([],'fictional_phone_a','A','allow');p['next'][field]=value;p['checksum']=a.sha(a.canonical({k:v for k,v in p.items() if k!='checksum'}))
   with self.assertRaisesRegex(RuntimeError,'PLAN_FIELDS_CHANGED'):self.apply(Backend(),p)
 def test_maximum_two_members(self):
  with self.assertRaises(RuntimeError):plan([row(),row('fictional_phone_b','B')],'third_phone','A','allow')
  with self.assertRaises(RuntimeError):a.check_members([row(),row('phone_b','B'),row('phone_c','A')])
 def test_non_anonymous_unknown_disabled_and_custom_rejected(self):
  client=a.Client('FICTIONAL_TOKEN')
  for account in [None,{'localId':'other'}, {'localId':'phone_a','disabled':True},{'localId':'phone_a','customAuth':True},{'localId':'phone_a','providerUserInfo':[{'providerId':'password'}]}]:
   with patch.object(client,'call',return_value={'users':[] if account is None else [account]}):
    with self.assertRaisesRegex(RuntimeError,'EXISTING_ANONYMOUS_PROFILE_REQUIRED'):client.anonymous('phone_a')
 def test_anonymous_lookup_mask_requests_no_passwords_or_personal_fields(self):
  client=a.Client('FICTIONAL_TOKEN')
  with patch.object(client,'call',return_value={'users':[{'localId':'phone_a'}]}) as call:
   client.anonymous('phone_a');url=call.call_args.args[1]
  self.assertIn('fields=users(localId,disabled,customAuth,providerUserInfo(providerId))',url)
  for field in ['passwordHash','email','phoneNumber','displayName']:self.assertNotIn(field,url)
 def test_admin_rejects_other_hosts_project_and_product_writes(self):
  client=a.Client('FICTIONAL_TOKEN')
  for host,path in [('firestore.googleapis.com','/v1/projects/other/databases/(default)/documents:commit'),('other.example',a.BASE+':commit'),('identitytoolkit.googleapis.com',f'/v1/projects/{a.PROJECT}/accounts:signUp')]:
   with self.assertRaisesRegex(RuntimeError,'A3_OPERATION_REFUSED'):client.call(host,path,{})
  fields={k:a.encode(v) for k,v in plan([],'phone_a','A','allow')['next'].items()}
  body={'transaction':'FAKE','writes':[{'update':{'name':a.DB+'/documents/products/milk','fields':fields},'updateTransforms':[{'fieldPath':'updatedAt','setToServerValue':'REQUEST_TIME'}],'currentDocument':{'exists':False}}]}
  with self.assertRaisesRegex(RuntimeError,'MEMBER_TARGET'):client.call('firestore.googleapis.com',a.BASE+':commit',body)
 def test_only_members_query_permitted(self):
  client=a.Client('FICTIONAL_TOKEN')
  with self.assertRaisesRegex(RuntimeError,'QUERY_SCOPE'):client.call('firestore.googleapis.com',a.BASE+':runQuery',{'structuredQuery':{'from':[{'collectionId':'products'}],'limit':3},'transaction':'FAKE'})
 def test_unconfirmed_plan_cannot_resume(self):
  p=a.make_plan([],'phone_a','A','allow')
  with self.assertRaisesRegex(RuntimeError,'PLAN_NOT_CONFIRMED'):a.apply_plan(Backend(),{'enabledSlots':['A']},p)
 def test_second_profile_disabled_while_only_iphone_available(self):
  p=plan([],'phone_b','B','allow')
  with self.assertRaisesRegex(RuntimeError,'PROFILE_SLOT_NOT_ENABLED'):a.apply_plan(Backend(),{'enabledSlots':['A']},p)
 def fixture_preflight(self,modify=None,products=None):
  sys.path.insert(0,str(ROOT/'scripts'));from preprod_cloud_shell import document
  spec=json.loads((ROOT/'security/firestore.indexes.json').read_text());seed=json.loads((ROOT/'config/preprod/seed-a2s-four-products.json').read_text())
  docs=[document(d) for d in seed['documents']] if products is None else products
  fields=[{'name':a.DB+'/collectionGroups/'+f['collectionGroup']+'/fields/'+f['fieldPath'],'indexConfig':{'indexes':[]}} for f in spec['fieldOverrides']]
  values={'project':{'projectId':a.PROJECT,'projectNumber':a.NUMBER,'state':'ACTIVE'},'billing':{'billingEnabled':False,'billingAccountLinked':False},'database':{'name':a.DB,'locationId':'europe-west6','freeTier':True,'databaseEdition':'STANDARD'},'rules':{'sourceSha256':['EXPECTED']},'indexes':[dict(spec['indexes'][0],name=a.DB+'/collectionGroups/operations/indexes/fake',state='READY')],'fieldOverrides':fields,'auth':{'anonymous':True,'email':False,'phoneNumber':False},'defaultSupportedIdpConfigs':[],'oauthIdpConfigs':[],'inboundSamlConfigs':[],'authUsers':{'count':1},'webApps':[{'appId':a.APP,'state':'ACTIVE'}],'webConfiguration':{'apiKeySha256':'PUBLIC_KEY_HASH','projectId':a.PROJECT,'appId':a.APP,'authDomain':a.PROJECT+'.firebaseapp.com','messagingSenderId':a.NUMBER}}
  if modify:modify(values)
  class Reader:
   def read(self,host,path,body=None):return {'collectionIds':['products']} if body else {'documents':docs}
  client=type('Client',(),{'reader':Reader()})()
  with patch.object(a,'inspect',return_value={k:{'status':'READ','value':v} for k,v in values.items()}):return a.preflight(client,{'rulesSha256':'EXPECTED','publicApiKeySha256':'PUBLIC_KEY_HASH'})
 def test_preflight_checks_actual_seed_and_free_target(self):
  self.assertTrue(self.fixture_preflight()['fourFixturesConfirmed'])
 def test_preflight_stops_if_seed_missing(self):
  with self.assertRaisesRegex(RuntimeError,'A2_FOUR_FIXTURES_NOT_READY'):self.fixture_preflight(products=[])
 def test_preflight_stops_if_rules_or_billing_changed(self):
  with self.assertRaisesRegex(RuntimeError,'A3_BILLING_NOT_FREE'):self.fixture_preflight(lambda v:v['billing'].update(billingAccountLinked=True))
  with self.assertRaisesRegex(RuntimeError,'A2_BACKEND_RULES_NOT_READY'):self.fixture_preflight(lambda v:v['rules'].update(sourceSha256=['OTHER']))
 def test_preflight_refuses_unexpected_provider_or_extra_auth_accounts(self):
  with self.assertRaisesRegex(RuntimeError,'A3_AUTH_PROVIDER_CHANGED'):self.fixture_preflight(lambda v:v['auth'].update(email=True))
  with self.assertRaisesRegex(RuntimeError,'UNEXPECTED_AUTH_ACCOUNT_COUNT'):self.fixture_preflight(lambda v:v['authUsers'].update(count=3))
 def test_preflight_failure_diagnostic_contains_only_check_codes(self):
  client=type('Client',(),{'reader':None})()
  with patch.object(a,'inspect',return_value={'project':{'status':'UNVERIFIED','error':'HTTP_403'}}):
   with self.assertRaises(a.ReadFailure) as caught:a.preflight(client,{})
  self.assertEqual(caught.exception.details['checks'][0],{'check':'project','error':'HTTP_403'})

if __name__=='__main__':unittest.main()
