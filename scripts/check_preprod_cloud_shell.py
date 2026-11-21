#!/usr/bin/env python3
"""A2-C: authenticated reads on the one approved project. No API activation."""
import hashlib
import json
import os
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

PROJECT = 'inventaire-v02-preprod-a1'
NUMBER = '319106753418'
APP = '1:319106753418:web:1cb076d86ed9face859e73'
DENY = "rules_version = '2'; service cloud.firestore { match /databases/{database}/documents { match /{document=**} { allow read, write: if false; } } }"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class ReadFailure(RuntimeError):
    def __init__(self, code, details=None):
        super().__init__(code)
        self.details = details or {}


class Reader:
    def __init__(self, token):
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect)

    def read(self, host, path, body=None):
        if host not in {'firebase.googleapis.com', 'cloudbilling.googleapis.com',
                        'firestore.googleapis.com', 'firebaserules.googleapis.com',
                        'identitytoolkit.googleapis.com'}:
            raise RuntimeError('HOST_REFUSED')
        if not re.match(r'^/(?:v1beta1|v1|v2|admin/v2)/projects/' + re.escape(PROJECT) + r'(?:/|$)', path):
            raise RuntimeError('TARGET_REFUSED')
        if body is not None and path != f'/v1/projects/{PROJECT}/databases/(default)/documents:listCollectionIds':
            raise RuntimeError('NON_READ_OPERATION_REFUSED')
        req = urllib.request.Request('https://' + host + path,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + self.token,
                     'Content-Type': 'application/json', 'x-goog-user-project': PROJECT},
            method='GET' if body is None else 'POST')
        try:
            with self.opener.open(req, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as err:
            details = {}
            try:
                error = json.loads(err.read(65536)).get('error', {})
                for item in error.get('details', []):
                    if item.get('@type') != 'type.googleapis.com/google.rpc.ErrorInfo':
                        continue
                    reason = item.get('reason', '')
                    if re.fullmatch(r'[A-Z_0-9]{1,100}', reason):
                        details['reason'] = reason
                    service = item.get('metadata', {}).get('service', '')
                    if service in {'firebase.googleapis.com', 'cloudbilling.googleapis.com', 'firestore.googleapis.com', 'firebaserules.googleapis.com', 'identitytoolkit.googleapis.com', 'serviceusage.googleapis.com'}:
                        details['service'] = service
            except (ValueError, AttributeError, TypeError):
                pass
            raise ReadFailure('HTTP_' + str(err.code), details) from None
        except (urllib.error.URLError, TimeoutError):
            raise RuntimeError('NETWORK_ERROR') from None

    def pages(self, host, path, key):
        result, seen, page = [], set(), ''
        for _ in range(20):
            parameter = 'nextPageToken' if '/accounts:batchGet' in path else 'pageToken'
            separator = '&' if '?' in path else '?'
            suffix = separator + parameter + '=' + urllib.parse.quote(page, safe='') if page else ''
            data = self.read(host, path + suffix)
            result.extend(data.get(key, []))
            page = data.get('nextPageToken', '')
            if not page:
                return result
            if page in seen:
                break
            seen.add(page)
        raise RuntimeError('INCOMPLETE_PAGINATION')


def read_billing(reader):
    """Use the same normal gcloud read that already succeeded in the owner's shell."""
    try:
        return reader.read('cloudbilling.googleapis.com', f'/v1/projects/{PROJECT}/billingInfo')
    except RuntimeError as err:
        if str(err) != 'HTTP_403':
            raise
        diagnostic = {'restError': 'HTTP_403', 'restDetails': getattr(err, 'details', {})}
    try:
        result = subprocess.run(['gcloud', 'billing', 'projects', 'describe', PROJECT, '--format=json'],
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=45)
        if result.returncode:
            raise ReadFailure('BILLING_GCLOUD_READ_REFUSED', diagnostic)
        data = json.loads(result.stdout)
    except (subprocess.TimeoutExpired, FileNotFoundError, ValueError):
        raise ReadFailure('BILLING_GCLOUD_READ_FAILED', diagnostic) from None
    if data.get('name') != 'projects/' + PROJECT + '/billingInfo' or data.get('projectId') != PROJECT:
        raise ReadFailure('BILLING_TARGET_NOT_CONFIRMED', diagnostic)
    return {**data, '_readSource': 'gcloud billing projects describe', '_restDiagnostic': diagnostic}


def inspect(reader):
    results = {}
    root = f'/v1/projects/{PROJECT}'

    def run(name, action):
        try:
            results[name] = {'status': 'READ', 'value': action()}
        except Exception as err:
            # No raw HTTP bodies, command errors, tokens or user identities in output.
            code = str(err)
            results[name] = {'status': 'UNVERIFIED', 'error': code if re.fullmatch(r'[A-Z_0-9]+', code) else 'READ_FAILED'}
            if isinstance(err, ReadFailure) and err.details:
                results[name]['details'] = err.details
        return results[name]

    project = run('project', lambda: reader.read('firebase.googleapis.com', f'/v1beta1/projects/{PROJECT}'))
    if project['status'] != 'READ' or project['value'].get('projectId') != PROJECT or str(project['value'].get('projectNumber')) != NUMBER:
        return {'project': {'status': 'STOP', 'error': 'PROJECT_NOT_CONFIRMED'}}
    project['value'] = {k: project['value'].get(k) for k in ['projectId', 'projectNumber', 'state']}
    bill = run('billing', lambda: read_billing(reader))
    if bill['status'] == 'READ':
        if '_readSource' in bill['value']:
            bill['readSource'] = bill['value']['_readSource']
            bill['restDiagnostic'] = bill['value']['_restDiagnostic']
    if bill['status'] != 'READ' or bill['value'].get('billingEnabled') is not False or bill['value'].get('billingAccountName'):
        if bill['status'] == 'READ':
            bill['value'] = {'billingEnabled': bill['value'].get('billingEnabled'), 'billingAccountLinked': bool(bill['value'].get('billingAccountName'))}
        return {**results, 'gate': {'status': 'STOP', 'error': 'FREE_BILLING_NOT_CONFIRMED'}}
    bill['value'] = {'billingEnabled': False, 'billingAccountLinked': False}
    db = run('database', lambda: reader.read('firestore.googleapis.com', root + '/databases/(default)'))
    if db['status'] != 'READ' or db['value'].get('name') != f'projects/{PROJECT}/databases/(default)' or db['value'].get('locationId') != 'europe-west6' or db['value'].get('freeTier') is not True:
        return {**results, 'gate': {'status': 'STOP', 'error': 'DATABASE_NOT_CONFIRMED'}}
    db['value'] = {k: db['value'].get(k) for k in ['name', 'locationId', 'freeTier', 'databaseEdition', 'pointInTimeRecoveryEnablement']}

    def rules():
        release = reader.read('firebaserules.googleapis.com', root + '/releases/cloud.firestore')
        name = release.get('rulesetName', '')
        if not re.fullmatch(r'projects/' + PROJECT + r'/rulesets/[A-Za-z0-9_-]+', name):
            raise RuntimeError('RULESET_TARGET_REFUSED')
        data = reader.read('firebaserules.googleapis.com', '/v1/' + name)
        files = data.get('source', {}).get('files', [])
        deny = len(files) == 1 and re.sub(r'\s+', '', files[0].get('content', '')) == re.sub(r'\s+', '', DENY)
        return {'rulesetName': name, 'releaseUpdateTime': release.get('updateTime'), 'denyAllExactWhitespaceOnly': deny,
                'sourceSha256': [hashlib.sha256(f.get('content', '').encode()).hexdigest() for f in files]}

    run('rules', rules)
    run('indexes', lambda: reader.pages('firestore.googleapis.com', root + '/databases/(default)/collectionGroups/-/indexes', 'indexes'))
    # The wildcard ListFields endpoint requires the override/TTL filter used by firebase-tools.
    field_filter = urllib.parse.urlencode({'filter': 'indexConfig.usesAncestorConfig=false OR ttlConfig:*'})
    run('fieldOverrides', lambda: reader.pages('firestore.googleapis.com', root + '/databases/(default)/collectionGroups/-/fields?' + field_filter, 'fields'))

    def collections():
        data = reader.read('firestore.googleapis.com', root + '/databases/(default)/documents:listCollectionIds', {'pageSize': 100})
        return {'rootCollectionCount': len(data.get('collectionIds', [])), 'complete': not bool(data.get('nextPageToken'))}

    run('collections', collections)

    def auth():
        data = reader.read('identitytoolkit.googleapis.com', f'/admin/v2/projects/{PROJECT}/config?fields=signIn(anonymous(enabled),email(enabled),phoneNumber(enabled))')
        sign = data.get('signIn', {})
        return {key: bool(sign.get(key, {}).get('enabled')) for key in ['anonymous', 'email', 'phoneNumber']}

    run('auth', auth)
    for kind, key in [('defaultSupportedIdpConfigs', 'defaultSupportedIdpConfigs'), ('oauthIdpConfigs', 'oauthIdpConfigs'), ('inboundSamlConfigs', 'inboundSamlConfigs')]:
        run(kind, lambda kind=kind, key=key: [{'enabled': bool(x.get('enabled'))} for x in reader.pages('identitytoolkit.googleapis.com', f'/v2/projects/{PROJECT}/{kind}?fields={key}(enabled),nextPageToken', key)])
    run('authUsers', lambda: {'count': len(reader.pages('identitytoolkit.googleapis.com', root + '/accounts:batchGet?fields=users(localId),nextPageToken', 'users'))})
    apps = run('webApps', lambda: reader.pages('firebase.googleapis.com', f'/v1beta1/projects/{PROJECT}/webApps', 'apps'))
    if apps['status'] == 'READ':
        apps['value'] = [{'appId': x.get('appId'), 'state': x.get('state')} for x in apps['value']]
        if APP in [x['appId'] for x in apps['value']]:
            def configuration():
                data = reader.read('firebase.googleapis.com', f'/v1beta1/projects/{PROJECT}/webApps/{APP}/config')
                key = data.pop('apiKey', '')
                return {k: data.get(k) for k in ['projectId', 'appId', 'authDomain', 'messagingSenderId', 'storageBucket']} | {'apiKeySha256': hashlib.sha256(key.encode()).hexdigest(), 'apiKeyPresent': bool(key)}
            run('webConfiguration', configuration)
    return results


def main():
    os.umask(0o077)
    token_result = subprocess.run(['gcloud', 'auth', 'print-access-token', '--project=' + PROJECT], capture_output=True, text=True, timeout=45)
    if token_result.returncode or not token_result.stdout.strip():
        raise SystemExit('AUTHENTICATION_REQUIRED: aucun secret a transmettre dans le chat.')
    report = {'format': 'inventaire-a2c-readonly', 'projectId': PROJECT,
              'executedAtUtc': datetime.now(timezone.utc).isoformat(),
              'provenance': 'owner-executed Cloud Shell API reads',
              'checks': inspect(Reader(token_result.stdout.strip()))}
    output = Path('inventaire-a2c-resultats-v2.json')
    with output.open('x', encoding='utf-8') as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
    print('Termine : inventaire-a2c-resultats-v2.json (aucun jeton ni compte utilisateur exporte).')


if __name__ == '__main__':
    main()
