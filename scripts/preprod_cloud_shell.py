#!/usr/bin/env python3
"""Approved A2-D/S lot. No production, project discovery, API activation or members."""
import argparse
import hashlib
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path
from check_preprod_cloud_shell import Reader, NoRedirect, ReadFailure, inspect, PROJECT, NUMBER, APP

ROOT=Path(__file__).resolve().parent
DB=f'projects/{PROJECT}/databases/(default)'
RULE_ROOT=f'/v1/projects/{PROJECT}'
FIELD_PATH='/v1/'+DB+'/collectionGroups/-/fields'
PERMISSIONS=['firebaserules.rulesets.create','firebaserules.releases.update','datastore.indexes.create','datastore.indexes.update','datastore.entities.create','datastore.databases.get','datastore.entities.list']
def sha(data):return hashlib.sha256(data).hexdigest()
def canonical(data):return json.dumps(data,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def load(name):return json.loads((ROOT/name).read_text())
def require(condition,code):
    if not condition:raise RuntimeError(code)


def package(expected):
    raw=(ROOT/'lot-manifest.json').read_bytes()
    require(sha(raw)==expected,'LOT_MANIFEST_HASH')
    m=json.loads(raw)
    require(m.get('format')=='inventaire-preprod-admin-lot' and m.get('version')==1,'LOT_FORMAT')
    require((m.get('projectId'),m.get('projectNumber'),m.get('databaseId'),m.get('location'))==(PROJECT,NUMBER,'(default)','europe-west6'),'LOT_TARGET')
    require(m.get('authorizedStages')==['A2-D','A2-S','A2-P'] and m.get('A3Authorized') is False,'LOT_SCOPE')
    for file,digest in m['files'].items():
        require(file in {'preprod_cloud_shell.py','check_preprod_cloud_shell.py','rules.firestore','indexes.json','seed.json','approval.json'},'LOT_FILE')
        require(sha((ROOT/file).read_bytes())==digest,'LOT_BYTES_CHANGED')
    require(set(m['files'])=={'preprod_cloud_shell.py','check_preprod_cloud_shell.py','rules.firestore','indexes.json','seed.json','approval.json'},'LOT_FILE_SET')
    approval=load('approval.json')
    require(approval['rulesSha256']==m['files']['rules.firestore'] and approval['indexesSha256']==m['files']['indexes.json'],'RULE_INDEX_APPROVAL')
    seed=load('seed.json')
    require(seed.get('authorized') is True and seed['projectId']==PROJECT and seed['databaseId']=='(default)','SEED_SCOPE')
    require(sha(canonical(seed['documents']))==approval['seedDocumentsSha256'],'SEED_DOCUMENT_HASH')
    require([d['id'] for d in seed['documents']]==['milk','butter','aptamil','eggs'] and all(d['collection']=='products' for d in seed['documents']),'SEED_IDS')
    return m


class Admin:
    def __init__(self,reader):self.reader=reader;self.lastOperation=None
    def send(self,host,path,body,method='POST'):
        # Only these explicitly approved API operations can mutate resources.
        allowed=(host=='firebaserules.googleapis.com' and ((method=='POST' and path==RULE_ROOT+'/rulesets') or (method=='PATCH' and path==RULE_ROOT+'/releases/cloud.firestore')))
        allowed=allowed or (host=='firestore.googleapis.com' and method=='POST' and path in ['/v1/'+DB+'/collectionGroups/operations/indexes','/v1/'+DB+'/documents:commit'])
        fields={('products','legacy'),('shoppingLines','contributions'),('shoppingLines','checks'),('operations','after'),('operations','receipt')}
        allowed=allowed or (host=='firestore.googleapis.com' and method=='PATCH' and any(path==f'/v1/{DB}/collectionGroups/{col}/fields/{field}?updateMask=indexConfig' for col,field in fields))
        permission_check=host=='cloudresourcemanager.googleapis.com' and method=='POST' and path==f'/v1/projects/{PROJECT}:testIamPermissions'
        require(allowed or permission_check,'ADMIN_OPERATION_REFUSED')
        self.lastOperation=method+' '+host+path
        if permission_check:require(body=={'permissions':PERMISSIONS},'PERMISSION_QUERY_CHANGED')
        if path.endswith('/documents:commit'):
            require(body=={'writes':[{'update':document(e),'currentDocument':{'exists':False}} for e in load('seed.json')['documents']]},'COMMIT_NOT_APPROVED_SEED')
        if path.endswith('/collectionGroups/operations/indexes'):
            require(body=={k:v for k,v in load('indexes.json')['indexes'][0].items() if k!='collectionGroup'},'INDEX_NOT_APPROVED')
        if method=='PATCH' and '/fields/' in path:
            require(body=={'indexConfig':{'indexes':[]}},'FIELD_WRITE_CHANGED')
        if path.endswith('/rulesets'):
            require(body=={'source':{'files':[{'name':'firestore.rules','content':(ROOT/'rules.firestore').read_text()}]}},'RULES_SOURCE_CHANGED')
        if path.endswith('/releases/cloud.firestore'):
            release=body.get('release',{})
            require(set(body)=={'release'} and set(release)=={'name','rulesetName'} and release['name']==f'projects/{PROJECT}/releases/cloud.firestore' and bool(re.fullmatch(r'projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',release['rulesetName'])),'RELEASE_TARGET')
        req=urllib.request.Request('https://'+host+path,data=json.dumps(body).encode(),method=method,headers={'Authorization':'Bearer '+self.reader.token,'Content-Type':'application/json'})
        try:
            with urllib.request.build_opener(NoRedirect).open(req,timeout=45) as response:return json.load(response)
        except urllib.error.HTTPError as err:raise ReadFailure('HTTP_'+str(err.code)) from None
        except (urllib.error.URLError,TimeoutError):raise RuntimeError('NETWORK_ERROR_NO_WRITE_RETRY') from None


def field_key(field):
    name=field.get('name','')
    prefix=DB+'/collectionGroups/'
    require(name.startswith(prefix),'FIELD_TARGET')
    bits=name[len(prefix):].split('/fields/')
    require(len(bits)==2,'FIELD_NAME')
    return tuple(bits)


def check_initial(checks,manifest,index_spec):
    required=['project','billing','database','rules','indexes','fieldOverrides','collections','auth','defaultSupportedIdpConfigs','oauthIdpConfigs','inboundSamlConfigs','authUsers','webApps','webConfiguration']
    require(all(checks.get(k,{}).get('status')=='READ' for k in required),'PREFLIGHT_UNVERIFIED')
    value=lambda name:checks[name]['value']
    require(value('project')['projectId']==PROJECT and str(value('project')['projectNumber'])==NUMBER and value('project')['state']=='ACTIVE','PROJECT_CHANGED')
    require(value('billing')=={'billingEnabled':False,'billingAccountLinked':False},'BILLING_NOT_FREE')
    db=value('database');require(db['name']==DB and db['locationId']=='europe-west6' and db['freeTier'] is True and db['databaseEdition']=='STANDARD','DATABASE_CHANGED')
    require(value('rules')['sourceSha256'] in [[manifest['initialRulesSourceSha256']],[manifest['files']['rules.firestore']]],'RULESET_UNEXPECTED')
    require(value('auth')=={'anonymous':True,'email':False,'phoneNumber':False},'AUTH_CHANGED')
    require(value('authUsers')['count']==0 and all(not value(k) for k in ['defaultSupportedIdpConfigs','oauthIdpConfigs','inboundSamlConfigs']),'AUTH_ACCOUNTS_OR_PROVIDERS_PRESENT')
    require(len(value('webApps'))==1 and value('webApps')[0]=={'appId':APP,'state':'ACTIVE'},'WEB_APP_CHANGED')
    c=value('webConfiguration');require(c['projectId']==PROJECT and c['appId']==APP and c['apiKeySha256']==manifest['publicApiKeySha256'] and c['authDomain']==PROJECT+'.firebaseapp.com' and c['messagingSenderId']==NUMBER,'WEB_CONFIG_CHANGED')
    require(value('collections')['complete'] and value('collections')['rootCollectionCount'] in [0,1],'COLLECTIONS_UNEXPECTED')
    expected=index_spec['indexes'][0]
    for index in value('indexes'):
        require(index.get('name','').startswith(DB+'/collectionGroups/operations/indexes/'),'INDEX_TARGET')
        require(index.get('queryScope')==expected['queryScope'] and [{k:f[k] for k in ['fieldPath','order'] if k in f} for f in index.get('fields',[]) if f.get('fieldPath')!='__name__']==expected['fields'],'INDEX_UNEXPECTED')
    require(len(value('indexes'))<=1,'MULTIPLE_INDEXES_UNEXPECTED')
    allowed={(f['collectionGroup'],f['fieldPath']) for f in index_spec['fieldOverrides']}
    for field in value('fieldOverrides'):
        require(not field.get('ttlConfig'),'TTL_UNEXPECTED')
        if field.get('name','').endswith('/fields/__default__'):continue
        require(field_key(field) in allowed and field.get('indexConfig',{}).get('indexes',[])==[],'FIELD_OVERRIDE_UNEXPECTED')


def encode(value):
    if value is None:return {'nullValue':None}
    if isinstance(value,bool):return {'booleanValue':value}
    if isinstance(value,int):return {'integerValue':str(value)}
    if isinstance(value,str):return {'stringValue':value}
    if isinstance(value,dict) and set(value)=={'timestampValue'}:return value
    if isinstance(value,dict):return {'mapValue':{'fields':{k:encode(v) for k,v in value.items()}}}
    raise RuntimeError('SEED_VALUE_TYPE')
def document(entry):return {'name':DB+'/documents/products/'+entry['id'],'fields':{k:encode(v) for k,v in entry['data'].items()}}
def normalize(value):
    if isinstance(value,dict):return {k:normalize(v) for k,v in value.items() if not (k=='mapValue' and v=={})}
    if isinstance(value,list):return [normalize(x) for x in value]
    return value
def seed_state(reader,entries):
    root=reader.read('firestore.googleapis.com','/v1/'+DB+'/documents:listCollectionIds',{'pageSize':100})
    require(not root.get('nextPageToken'),'COLLECTION_LIST_INCOMPLETE')
    names=root.get('collectionIds',[])
    if not names:return 'empty'
    require(names==['products'],'DATABASE_NOT_EMPTY')
    data=reader.read('firestore.googleapis.com','/v1/'+DB+'/documents/products?pageSize=5')
    require(not data.get('nextPageToken'),'PRODUCT_LIST_INCOMPLETE')
    actual={d['name']:normalize(d['fields']) for d in data.get('documents',[])}
    expected={d['name']:normalize(d['fields']) for d in map(document,entries)}
    require(actual==expected,'SEED_CONFLICT_NO_OVERWRITE')
    return 'identical'


def apply(reader,admin,manifest,report):
    report['phase']='preflight'
    index_spec=load('indexes.json');entries=load('seed.json')['documents']
    checks=inspect(reader);report['preflight']=checks
    check_initial(checks,manifest,index_spec)
    state=seed_state(reader,entries)
    permissions=admin.send('cloudresourcemanager.googleapis.com',f'/v1/projects/{PROJECT}:testIamPermissions',{'permissions':PERMISSIONS})
    require(set(permissions.get('permissions',[]))==set(PERMISSIONS),'ADMIN_PERMISSIONS_MISSING')
    release=reader.read('firebaserules.googleapis.com',RULE_ROOT+'/releases/cloud.firestore')
    require(re.fullmatch(r'projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',release.get('rulesetName','')),'RULESET_TARGET')
    source=reader.read('firebaserules.googleapis.com','/v1/'+release['rulesetName'])
    initial_name=load('approval.json')['initialRulesetName']
    require(re.fullmatch(r'projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',initial_name),'INITIAL_RULESET_TARGET')
    initial=reader.read('firebaserules.googleapis.com','/v1/'+initial_name)
    initial_files=initial.get('source',{}).get('files',[])
    require(len(initial_files)==1 and sha(initial_files[0]['content'].encode())==manifest['initialRulesSourceSha256'],'INITIAL_RULESET_HASH')
    backup={'projectId':PROJECT,'projectNumber':NUMBER,'release':release,'ruleset':source,'initialRulesetName':initial_name,'initialRuleset':initial,'indexes':checks['indexes']['value'],'fieldOverrides':checks['fieldOverrides']['value']}
    backup_name=ROOT/('backup-before-'+str(time.time_ns())+'.json')
    with backup_name.open('x') as f:json.dump(backup,f,indent=2)
    require(json.loads(backup_name.read_text())==backup,'BACKUP_VERIFICATION_FAILED')
    report['backupFile']=backup_name.name;report['backupSha256']=sha(backup_name.read_bytes())
    report['phase']='rules'
    if checks['rules']['value']['sourceSha256']!=[manifest['files']['rules.firestore']]:
        created=admin.send('firebaserules.googleapis.com',RULE_ROOT+'/rulesets',{'source':{'files':[{'name':'firestore.rules','content':(ROOT/'rules.firestore').read_text()}]}})
        require(re.fullmatch(r'projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',created.get('name','')),'CREATED_RULESET_TARGET')
        admin.send('firebaserules.googleapis.com',RULE_ROOT+'/releases/cloud.firestore',{'release':{'name':f'projects/{PROJECT}/releases/cloud.firestore','rulesetName':created['name']}},'PATCH')
    report['rules']='published';print('Regles publiees et sauvegarde locale conservee.',flush=True)
    report['phase']='indexes'
    indexes=checks['indexes']['value']
    if not indexes:
        admin.send('firestore.googleapis.com','/v1/'+DB+'/collectionGroups/operations/indexes',{k:v for k,v in index_spec['indexes'][0].items() if k!='collectionGroup'})
    existing={field_key(f) for f in checks['fieldOverrides']['value'] if not f.get('name','').endswith('/fields/__default__')}
    for f in index_spec['fieldOverrides']:
        if (f['collectionGroup'],f['fieldPath']) in existing:continue
        name=DB+'/collectionGroups/'+f['collectionGroup']+'/fields/'+f['fieldPath']
        admin.send('firestore.googleapis.com','/v1/'+name+'?updateMask=indexConfig',{'indexConfig':{'indexes':[]}},'PATCH')
    deadline=time.monotonic()+180
    while True:
        indexes=reader.pages('firestore.googleapis.com','/v1/'+DB+'/collectionGroups/-/indexes','indexes')
        if len(indexes)==1 and indexes[0].get('state')=='READY':break
        require(time.monotonic()<deadline,'INDEX_NOT_READY_RERUN_SAME_LOT_LATER')
        time.sleep(3)
    after=inspect(reader);check_initial(after,manifest,index_spec)
    require(after['rules']['value']['sourceSha256']==[manifest['files']['rules.firestore']],'PUBLISHED_RULES_HASH')
    require({field_key(f) for f in after['fieldOverrides']['value'] if not f.get('name','').endswith('/fields/__default__')}=={(f['collectionGroup'],f['fieldPath']) for f in index_spec['fieldOverrides']},'FIELD_OVERRIDE_VERIFICATION')
    # Re-read before seeding; no overwrite even if another administrator acted.
    report['phase']='seed'
    state=seed_state(reader,entries)
    if state=='empty':
        writes=[{'update':document(entry),'currentDocument':{'exists':False}} for entry in entries]
        admin.send('firestore.googleapis.com','/v1/'+DB+'/documents:commit',{'writes':writes})
    require(seed_state(reader,entries)=='identical','SEED_VERIFICATION')
    report.update({'phase':'complete','indexes':'READY','seed':'created' if state=='empty' else 'identical-no-op','productCount':4,'membersCreated':0,'authUsersCreated':0,'backendReady':True,'A3Authorized':False})


def rollback(reader,admin,backup,manifest):
    require(backup['projectId']==PROJECT and backup['projectNumber']==NUMBER,'BACKUP_TARGET')
    files=backup['initialRuleset'].get('source',{}).get('files',[])
    approval=load('approval.json')
    require(len(files)==1 and sha(files[0]['content'].encode())==approval['initialRulesSourceSha256'],'ROLLBACK_DENY_ALL_REQUIRED')
    name=backup['initialRulesetName']
    require(re.fullmatch(r'projects/'+PROJECT+r'/rulesets/[A-Za-z0-9_-]+',name),'ROLLBACK_RULESET_TARGET')
    remote=reader.read('firebaserules.googleapis.com','/v1/'+name).get('source',{}).get('files',[])
    require(len(remote)==1 and sha(remote[0]['content'].encode())==approval['initialRulesSourceSha256'],'ROLLBACK_REMOTE_RULESET_HASH')
    checks=inspect(reader);check_initial(checks,manifest=manifest,index_spec=load('indexes.json'))
    admin.send('firebaserules.googleapis.com',RULE_ROOT+'/releases/cloud.firestore',{'release':{'name':f'projects/{PROJECT}/releases/cloud.firestore','rulesetName':name}},'PATCH')
    require(reader.read('firebaserules.googleapis.com',RULE_ROOT+'/releases/cloud.firestore').get('rulesetName')==name,'ROLLBACK_RELEASE_VERIFICATION')
    print('Deny-all retabli. Donnees et index conserves.')


def main():
    os.umask(0o077)
    parser=argparse.ArgumentParser();parser.add_argument('--apply');parser.add_argument('--rollback-rules',nargs=2,metavar=('LOT_SHA256','BACKUP_FILE'))
    args=parser.parse_args();require(bool(args.apply)!=bool(args.rollback_rules),'EXACTLY_ONE_ACTION')
    digest=args.apply or args.rollback_rules[0];manifest=package(digest)
    result=subprocess.run(['gcloud','auth','print-access-token','--project='+PROJECT],capture_output=True,text=True,stdin=subprocess.DEVNULL,timeout=45)
    require(result.returncode==0 and bool(result.stdout.strip()),'NORMAL_AUTHENTICATION_REQUIRED')
    reader=Reader(result.stdout.strip());admin=Admin(reader)
    if args.rollback_rules:
        path=(ROOT/args.rollback_rules[1]).resolve();require(path.parent==ROOT and path.name.startswith('backup-before-'),'BACKUP_PATH')
        rollback(reader,admin,json.loads(path.read_text()),manifest);return
    report={'format':'inventaire-preprod-apply-result','projectId':PROJECT,'projectNumber':NUMBER,'lotSha256':digest,'backendReady':False,'cloudflarePublished':False}
    try:apply(reader,admin,manifest,report)
    except Exception as err:
        code=str(err);report['error']=code if re.fullmatch(r'[A-Z_0-9]+',code) else 'OPERATION_FAILED_NO_AUTOMATIC_RETRY'
        report['lastAdministrativeOperation']=admin.lastOperation
    filename=ROOT/('resultat-mise-en-service-'+str(time.time_ns())+'.json')
    with filename.open('x') as f:json.dump(report,f,ensure_ascii=False,indent=2)
    print('Resultat : '+filename.name)
    if report['backendReady']:print('BACKEND PRET. Aucun membre autorise. Publier ensuite le ZIP Pages approuve.')
    else:raise SystemExit('ARRET : '+report.get('error','NON_CONFIRME')+'. Conserver resultat et sauvegarde ; ne pas publier Pages.')
if __name__=='__main__':main()
