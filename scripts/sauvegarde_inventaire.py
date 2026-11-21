#!/usr/bin/env python3
"""Production: read-only inventory backup using the owner's normal Cloud Shell login.

No Firebase deployment, export service, billing change, account creation or data
write. POST is allowed solely for Firestore's read-only listCollectionIds RPC.
Private backup stays in Cloud Shell; the separate report contains no document
names, field values, accounts, tokens or Firebase web configuration.
"""
import datetime as dt
import decimal
import email.utils
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

PROJECT = 'inventaire-maison-8fd95'
DATABASE = 'projects/' + PROJECT + '/databases/(default)'
DOCUMENTS = DATABASE + '/documents'
CORE = ('products', 'shoppingLines', 'operations', 'members')
LIMIT = 10000
SCRIPT_VERSION = 3
MAX_READ_ATTEMPTS = 4


class Stop(Exception):
    pass


def require(ok, code):
    if not ok:
        raise Stop(code)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(',', ':'), allow_nan=False).encode('utf-8')


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def allowed_request(host, path, body=None):
    """Closed host/path/verb policy, rechecked for every outgoing request."""
    parts = urllib.parse.urlsplit(path)
    require(not parts.scheme and not parts.netloc and not parts.fragment,
            'REQUEST_SCOPE')
    route = urllib.parse.unquote(parts.path)
    query = urllib.parse.parse_qs(parts.query, keep_blank_values=True)
    if host == 'firestore.googleapis.com':
        if route.startswith('/v1/' + DOCUMENTS + '/') or route == '/v1/' + DOCUMENTS + ':listCollectionIds':
            tail = route[len('/v1/' + DOCUMENTS):]
            names = tail.removesuffix(':listCollectionIds').strip('/').split('/') if tail != ':listCollectionIds' else []
            require(all(x and x not in ('.', '..') for x in names), 'DOCUMENT_PATH')
            if body is not None:
                require(route.endswith(':listCollectionIds') and len(names) % 2 == 0
                        and set(body) <= {'pageSize', 'pageToken'}
                        and body.get('pageSize') == 1000 and not query,
                        'READ_RPC_ONLY')
            else:
                require(len(names) % 2 == 1 and set(query) <= {'pageSize', 'pageToken', 'showMissing'}
                        and query.get('pageSize') == ['1000']
                        and query.get('showMissing') == ['true'], 'LIST_DOCUMENTS_ONLY')
            return
        require(body is None and not query and route == '/v1/' + DATABASE,
                'DATABASE_READ_ONLY')
        return
    require(body is None and not query, 'METADATA_READ_ONLY')
    fixed = {
        'cloudresourcemanager.googleapis.com': '/v1/projects/' + PROJECT,
        'cloudbilling.googleapis.com': '/v1/projects/' + PROJECT + '/billingInfo',
        'firebaserules.googleapis.com': '/v1/projects/' + PROJECT + '/releases/cloud.firestore',
    }
    if host == 'firebaserules.googleapis.com' and re.fullmatch(
            '/v1/projects/' + PROJECT + '/rulesets/[A-Za-z0-9_-]+', route):
        return
    require(host in fixed and route == fixed[host], 'METADATA_TARGET')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class Reader:
    def __init__(self, token):
        self.token = token
        self.opener = urllib.request.build_opener(NoRedirect)
        self.last_diagnostic = {}
        self.retry_count = 0

    def diagnostic(self, host, path):
        if host == 'cloudresourcemanager.googleapis.com':
            operation = 'project.metadata'
        elif host == 'cloudbilling.googleapis.com':
            operation = 'billing.metadata'
        elif host == 'firebaserules.googleapis.com':
            operation = 'rules.release' if '/releases/' in path else 'rules.source'
        elif path.endswith(':listCollectionIds'):
            operation = 'collections.list'
        elif '/documents/' in path:
            operation = 'documents.list'
        else:
            operation = 'database.metadata'
        return {'api': host, 'operation': operation, 'quotaProjectId': PROJECT}

    def read_failure(self, error):
        self.last_diagnostic['httpStatus'] = error.code
        # Keep only documented reason/status/permission identifiers. Never retain
        # raw messages, principal names, activation URLs, documents or tokens.
        try:
            payload = json.loads(error.read(65536)).get('error', {})
            status = payload.get('status')
            if isinstance(status, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{1,79}', status):
                self.last_diagnostic['status'] = status
            reasons, permissions = set(), set()
            for detail in payload.get('details', []):
                if not isinstance(detail, dict) or detail.get('@type') != 'type.googleapis.com/google.rpc.ErrorInfo':
                    continue
                reason = detail.get('reason')
                if isinstance(reason, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{1,79}', reason):
                    reasons.add(reason)
                permission = detail.get('metadata', {}).get('permission')
                if isinstance(permission, str) and re.fullmatch(r'[a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*){1,5}', permission):
                    permissions.add(permission)
                consumer = detail.get('metadata', {}).get('consumer')
                if isinstance(consumer, str) and re.fullmatch(r'projects/\d{4,24}', consumer):
                    self.last_diagnostic['quotaConsumer'] = consumer
            if reasons:
                self.last_diagnostic['reasonCodes'] = sorted(reasons)
            if permissions:
                self.last_diagnostic['permissions'] = sorted(permissions)
        except (ValueError, TypeError, AttributeError):
            pass

    def read(self, host, path, body=None):
        for attempt in range(MAX_READ_ATTEMPTS):
            allowed_request(host, path, body)
            self.last_diagnostic = self.diagnostic(host, path)
            self.last_diagnostic['attempt'] = attempt + 1
            # Attribute quota to this project, rather than an implicit OAuth
            # client's shared quota project. This does not link a billing account.
            headers = {'Authorization': 'Bearer ' + self.token, 'Accept': 'application/json',
                       'X-Goog-User-Project': PROJECT}
            data = None
            if body is not None:
                headers['Content-Type'] = 'application/json'
                data = canonical(body)
            request = urllib.request.Request('https://' + host + path, data=data,
                                             headers=headers, method='POST' if body is not None else 'GET')
            try:
                with self.opener.open(request, timeout=45) as response:
                    raw = response.read(32 * 1024 * 1024 + 1)
                    require(len(raw) <= 32 * 1024 * 1024, 'RESPONSE_TOO_LARGE')
                    return json.loads(raw)
            except urllib.error.HTTPError as error:
                self.read_failure(error)
                requested = retry_after_seconds((error.headers or {}).get('Retry-After'))
                if requested:
                    self.last_diagnostic['retryAfterSeconds'] = requested
                # Every approved operation is a read. Never retry authentication,
                # permission failures or service activation; never increase quota.
                if error.code not in (429, 503) or attempt + 1 == MAX_READ_ATTEMPTS or requested > 60:
                    raise Stop('HTTP_' + str(error.code)) from None
                delay = max(5 * 2**attempt, requested)
                self.retry_count += 1
                print('Google limite temporairement les lectures : attente de ' + str(delay)
                      + ' s, puis reprise automatique (' + str(attempt + 2) + '/' + str(MAX_READ_ATTEMPTS) + ').', flush=True)
                time.sleep(delay)
            except (urllib.error.URLError, TimeoutError):
                raise Stop('NETWORK_ERROR') from None


def retry_after_seconds(value):
    if not isinstance(value, str):
        return 0
    try:
        if re.fullmatch(r'\d+', value.strip()):
            return int(value.strip())
        when = email.utils.parsedate_to_datetime(value)
        if when.tzinfo is None:
            when = when.replace(tzinfo=dt.timezone.utc)
        seconds = (when - dt.datetime.now(dt.timezone.utc)).total_seconds()
        return max(0, int(seconds) + (1 if seconds > int(seconds) else 0))
    except (ValueError, TypeError, OverflowError):
        return 0


def pages(reader, path, is_collections=False):
    token = None
    seen = set()
    while True:
        if is_collections:
            body = {'pageSize': 1000}
            if token:
                body['pageToken'] = token
            result = reader.read('firestore.googleapis.com', path + ':listCollectionIds', body)
            yield from result.get('collectionIds', [])
        else:
            query = {'pageSize': 1000, 'showMissing': 'true'}
            if token:
                query['pageToken'] = token
            result = reader.read('firestore.googleapis.com', path + '?' + urllib.parse.urlencode(query))
            yield from result.get('documents', [])
        token = result.get('nextPageToken')
        if not token:
            return
        require(isinstance(token, str) and token not in seen and len(seen) < LIMIT, 'PAGINATION_LOOP')
        seen.add(token)


def snapshot(reader):
    docs, collections, paths = [], [], set()
    total_bytes = 0
    pending = [DOCUMENTS]
    while pending:
        parent = pending.pop()
        require(len(parent.split('/')) <= len(DOCUMENTS.split('/')) + 200, 'NESTING_LIMIT')
        for name in pages(reader, '/v1/' + urllib.parse.quote(parent, safe='/'), True):
            require(isinstance(name, str) and name and '/' not in name, 'COLLECTION_ID')
            collection = parent + '/' + name
            require(collection not in collections, 'DUPLICATE_COLLECTION')
            collections.append(collection)
            require(len(collections) <= LIMIT, 'COLLECTION_LIMIT')
            for doc in pages(reader, '/v1/' + urllib.parse.quote(collection, safe='/')):
                path = doc.get('name', '')
                require(path.startswith(collection + '/') and '/' not in path[len(collection) + 1:]
                        and path not in paths, 'DOCUMENT_SCOPE')
                paths.add(path)
                require(len(paths) <= LIMIT, 'DOCUMENT_LIMIT')
                pending.append(path)  # Include subcollections beneath missing parent documents.
                if 'updateTime' in doc:
                    require(isinstance(doc.get('fields', {}), dict), 'DOCUMENT_FORMAT')
                    total_bytes += len(canonical(doc))
                    require(total_bytes <= 32 * 1024 * 1024, 'BACKUP_SIZE_LIMIT')
                    docs.append(doc)
    return {'documents': sorted(docs, key=lambda d: d['name']),
            'collectionPaths': sorted(collections), 'complete': True}


def scalar(fields, name):
    v = fields.get(name, {})
    if 'stringValue' in v:
        return v['stringValue']
    if 'integerValue' in v:
        return int(v['integerValue'])
    if 'doubleValue' in v:
        return v['doubleValue']
    if 'booleanValue' in v:
        return v['booleanValue']
    return None


def micros(value):
    require(type(value) in (str, int, float), 'quantity-type')
    try:
        n = decimal.Decimal(str(value).replace(',', '.'))
        require(n.is_finite() and n >= 0 and n <= 1000000, 'quantity-range')
        scaled = n * 1000000
        require(scaled == scaled.to_integral_value(), 'quantity-precision')
        return int(scaled)
    except decimal.InvalidOperation:
        raise Stop('quantity-invalid') from None


def model_report(data):
    counts = {name: 0 for name in CORE}
    kinds = {'legacy': 0, 'canonical': 0, 'unknown': 0}
    issues = {}
    for doc in data['documents']:
        path = doc['name'][len(DOCUMENTS) + 1:].split('/')
        if len(path) != 2 or path[0] not in CORE:
            continue
        counts[path[0]] += 1
        if path[0] != 'products':
            continue
        f = doc.get('fields', {})
        kind = 'canonical' if scalar(f, 'schemaVersion') == 2 else 'legacy' if all(k in f for k in ('stock', 'threshold', 'target')) else 'unknown'
        kinds[kind] += 1
        try:
            require(kind != 'unknown', 'schema-unrecognized')
            require(isinstance(scalar(f, 'name'), str) and 0 < len(scalar(f, 'name').strip()) <= 180, 'name-review')
            require(isinstance(scalar(f, 'unit'), str) and 0 < len(scalar(f, 'unit').strip()) <= 64, 'unit-review')
            require('id' not in f or scalar(f, 'id') == path[1], 'embedded-id-mismatch')
            require(bool(path[1].strip()) and len(path[1]) <= 128, 'id-length')
            if kind == 'legacy':
                for key in ('stock', 'threshold', 'target'):
                    micros(scalar(f, key))
                require((scalar(f, 'frequency') or '') in ('', 'quotidien', 'hebdomadaire', 'mensuel', 'trimestriel'), 'frequency-review')
                require('lastRestocked' not in f or 'stringValue' in f['lastRestocked']
                        or 'nullValue' in f['lastRestocked'], 'restocked-date-type')
                restocked = scalar(f, 'lastRestocked')
                if restocked is not None:
                    require(isinstance(restocked, str), 'restocked-date-type')
                    try:
                        dt.datetime.fromisoformat(restocked.replace('Z', '+00:00'))
                    except ValueError:
                        raise Stop('restocked-date-review') from None
            else:
                require(type(scalar(f, 'schemaVersion')) is int, 'canonical-schema-review')
                for key in ('stockMicros', 'thresholdMicros', 'targetMicros', 'revision'):
                    v = scalar(f, key)
                    require(type(v) is int and 0 <= v <= 10**12, 'canonical-number-review')
                require(scalar(f, 'revision') > 0 and 'mapValue' in f.get('legacy', {}), 'canonical-context-review')
        except Stop as error:
            issues[str(error)] = issues.get(str(error), 0) + 1
    return {'rootDocumentCounts': counts, 'totalDocumentCount': len(data['documents']),
            'otherOrNestedDocumentCount': len(data['documents']) - sum(counts.values()),
            'productModels': kinds, 'basicReviewIssues': issues,
            'migrationRequired': kinds['legacy'] > 0,
            'migrationExecuted': False, 'fullMigrationValidationStillRequired': True}


def write_private(path, value):
    raw = canonical(value) + b'\n'
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(raw)
        stream.flush()
        os.fsync(stream.fileno())
    require(json.loads(Path(path).read_bytes()) == value, 'LOCAL_READBACK_FAILED')
    return hashlib.sha256(raw).hexdigest()


def export(reader, folder):
    project = reader.read('cloudresourcemanager.googleapis.com', '/v1/projects/' + PROJECT)
    require(project.get('projectId') == PROJECT and project.get('lifecycleState') == 'ACTIVE', 'PROJECT_MISMATCH')
    billing = reader.read('cloudbilling.googleapis.com', '/v1/projects/' + PROJECT + '/billingInfo')
    require(billing.get('billingEnabled') is False and not billing.get('billingAccountName'), 'BILLING_REVIEW_REQUIRED')
    database = reader.read('firestore.googleapis.com', '/v1/' + DATABASE)
    require(database.get('name') == DATABASE and database.get('type') == 'FIRESTORE_NATIVE', 'DATABASE_MISMATCH')
    require(database.get('freeTier') is not False, 'FREE_TIER_REVIEW_REQUIRED')
    release_path = '/v1/projects/' + PROJECT + '/releases/cloud.firestore'
    release = reader.read('firebaserules.googleapis.com', release_path)
    name = release.get('rulesetName', '')
    require(re.fullmatch('projects/' + PROJECT + '/rulesets/[A-Za-z0-9_-]+', name), 'RULESET_SCOPE')
    ruleset = reader.read('firebaserules.googleapis.com', '/v1/' + name)
    first = snapshot(reader)
    second = snapshot(reader)
    require(digest(first) == digest(second), 'DATA_CHANGED_CLOSE_APPLICATIONS_AND_RETRY')
    require(reader.read('firebaserules.googleapis.com', release_path).get('rulesetName') == name, 'RULES_CHANGED_DURING_BACKUP')
    payload = {'format': 'inventaire-production-backup', 'version': 1, 'projectId': PROJECT,
               'projectNumber': str(project.get('projectNumber', '')), 'databaseId': '(default)',
               'createdAt': dt.datetime.now(dt.timezone.utc).isoformat(),
               'consistency': 'two-identical-scans-with-update-times', 'project': project,
               'billing': billing, 'database': database, 'publishedRulesRelease': release,
               'publishedRuleset': ruleset, 'data': second}
    backup = dict(payload, checksum=digest(payload))
    filename = folder / 'sauvegarde-complete.json'
    file_hash = write_private(filename, backup)
    readback = json.loads(filename.read_bytes())
    require(readback['checksum'] == digest({k: v for k, v in readback.items() if k != 'checksum'}), 'BACKUP_CHECKSUM')
    return {'format': 'inventaire-production-verification', 'version': 1, 'status': 'BACKUP_VERIFIED',
            'projectId': PROJECT, 'projectNumber': str(project.get('projectNumber', '')),
            'databaseId': '(default)', 'location': database.get('locationId'),
            'billingAccountLinked': False, 'cloudWrites': 0,
            'backupFolder': folder.name, 'backupFile': filename.name,
            'backupFileSha256': file_hash, 'backupChecksum': backup['checksum'],
            'rulesSourceSha256': digest(ruleset.get('source', {})), **model_report(second)}


def main():
    os.umask(0o077)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder = Path('inventaire-sauvegarde-' + stamp + '-' + uuid.uuid4().hex[:6])
    folder.mkdir(mode=0o700)
    report = {'format': 'inventaire-production-verification', 'version': 1,
              'scriptVersion': SCRIPT_VERSION, 'status': 'STOPPED', 'projectId': PROJECT, 'cloudWrites': 0}
    reader = None
    try:
        result = subprocess.run(['gcloud', 'auth', 'print-access-token', '--project=' + PROJECT],
                                stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=45)
        require(result.returncode == 0 and bool(result.stdout.strip()), 'GOOGLE_SIGN_IN_REQUIRED')
        reader = Reader(result.stdout.strip())
        print('Sauvegarde v' + str(SCRIPT_VERSION) + ' : lecture du projet ' + PROJECT
              + '. Ne modifie pas les stocks pendant la sauvegarde.', flush=True)
        report = export(reader, folder)
        print('SAUVEGARDE VERIFIEE. Conserve le dossier ' + folder.name + '.', flush=True)
    except (Stop, FileNotFoundError, subprocess.TimeoutExpired) as error:
        code = str(error) if isinstance(error, Stop) else 'GCLOUD_UNAVAILABLE_OR_TIMED_OUT'
        report['error'] = code
        print('ARRET : ' + code + '. Aucun changement Firebase.', flush=True)
    except Exception:
        report['error'] = 'UNEXPECTED_ERROR_NO_CLOUD_WRITE'
        print('ARRET : erreur de lecture ou fichier local. Aucun changement Firebase.', flush=True)
    report['scriptVersion'] = SCRIPT_VERSION
    report['readRetries'] = getattr(reader, 'retry_count', 0)
    if report['status'] == 'STOPPED' and reader is not None and reader.last_diagnostic:
        report['diagnostic'] = reader.last_diagnostic
        print('API : ' + reader.last_diagnostic['api'] + ' ; controle : ' + reader.last_diagnostic['operation'], flush=True)
        if reader.last_diagnostic.get('reasonCodes'):
            print('Motif : ' + ', '.join(reader.last_diagnostic['reasonCodes']), flush=True)
    path = Path('inventaire-verification.json')
    if path.exists():
        path = Path('inventaire-verification-' + uuid.uuid4().hex[:6] + '.json')
    write_private(path, report)
    print('Fichier a transmettre : ' + path.name, flush=True)
    print('La sauvegarde complete reste privee : ne la joins pas a la conversation.', flush=True)
    return 0 if report['status'] == 'BACKUP_VERIFIED' else 1


if __name__ == '__main__':
    sys.exit(main())
