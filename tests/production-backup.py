"""Only fictional API fixtures; never contact a Firebase project."""
import contextlib
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import types
import unittest
import urllib.error
from unittest.mock import patch
from urllib.parse import urlsplit, unquote

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('production_backup', ROOT / 'scripts/sauvegarde_inventaire.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def document(path, fields, exists=True):
    d = {'name': m.DOCUMENTS + '/' + path}
    if exists:
        d.update(fields=fields, createTime='2000-01-01T00:00:00Z', updateTime='2000-01-02T00:00:00Z')
    return d


def string(s):
    return {'stringValue': s}


def integer(n):
    return {'integerValue': str(n)}


class Fake:
    def __init__(self):
        self.calls = []
        self.billing = {'billingEnabled': False, 'billingAccountName': ''}
        self.project = {'projectId': m.PROJECT, 'projectNumber': '111222333', 'lifecycleState': 'ACTIVE'}
        self.database = {'name': m.DATABASE, 'type': 'FIRESTORE_NATIVE', 'locationId': 'eur3', 'freeTier': True}
        self.product = document('products/old-id', {'id': string('old-id'), 'name': string('PRIVATE_PRODUCT'),
                                'unit': string('kg'), 'stock': {'doubleValue': 1.25},
                                'threshold': integer(2), 'target': integer(5),
                                'notes': string('PRIVATE_NOTE'), 'custom': {'mapValue': {'fields': {'value': string('UNKNOWN_FIELD')}}}})
        self.collections = {m.DOCUMENTS: ['products', 'members'], m.DOCUMENTS + '/products/missing-parent': ['nested']}
        self.documents = {m.DOCUMENTS + '/products': [self.product, document('products/missing-parent', {}, False)],
                          m.DOCUMENTS + '/members': [document('members/PRIVATE_UID', {'uid': string('PRIVATE_UID')})],
                          m.DOCUMENTS + '/products/missing-parent/nested': [document('products/missing-parent/nested/n', {'text': string('PRIVATE_SUBCOLLECTION')})]}
        self.changed = False
        self.product_reads = 0

    def read(self, host, path, body=None):
        m.allowed_request(host, path, body)
        self.calls.append((host, path, body))
        route = unquote(urlsplit(path).path).removeprefix('/v1/')
        if host == 'cloudresourcemanager.googleapis.com':
            value = self.project
        elif host == 'cloudbilling.googleapis.com':
            value = self.billing
        elif host == 'firebaserules.googleapis.com':
            value = {'rulesetName': 'projects/' + m.PROJECT + '/rulesets/fake-rules'} if '/releases/' in path else {'source': {'files': [{'name': 'firestore.rules', 'content': 'allow read, write: if false;'}]}}
        elif route == m.DATABASE:
            value = self.database
        elif body is not None:
            value = {'collectionIds': self.collections.get(route.removesuffix(':listCollectionIds'), [])}
        else:
            value = {'documents': copy.deepcopy(self.documents.get(route, []))}
            if route == m.DOCUMENTS + '/products':
                self.product_reads += 1
                if self.changed and self.product_reads > 1:
                    value['documents'][0]['fields']['stock'] = integer(999)
        return copy.deepcopy(value)


class Checks(unittest.TestCase):
    def test_rate_limit_retry_uses_explicit_project_and_respects_retry_after(self):
        reader = m.Reader('PRIVATE_TOKEN')
        requests = []

        def opened(request, **kwargs):
            requests.append(request)
            if len(requests) == 1:
                raise urllib.error.HTTPError(request.full_url, 429, 'Too Many Requests', {'Retry-After': '12'},
                                             io.BytesIO(b'{"error":{"status":"RESOURCE_EXHAUSTED"}}'))
            return io.BytesIO(b'{"ok":true}')
        reader.opener = types.SimpleNamespace(open=opened)
        with patch.object(m.time, 'sleep') as sleep, contextlib.redirect_stdout(io.StringIO()):
            result = reader.read('cloudresourcemanager.googleapis.com', '/v1/projects/' + m.PROJECT)
        self.assertEqual(result, {'ok': True})
        self.assertEqual(reader.retry_count, 1)
        sleep.assert_called_once_with(12)
        self.assertEqual(len(requests), 2)
        for request in requests:
            headers = {k.lower(): v for k, v in request.header_items()}
            self.assertEqual(headers['x-goog-user-project'], m.PROJECT)
            self.assertEqual(request.get_method(), 'GET')

    def test_persistent_rate_limit_is_bounded_without_quota_or_billing_changes(self):
        reader = m.Reader('PRIVATE_TOKEN')
        requests = []

        def opened(request, **kwargs):
            requests.append(request)
            raise urllib.error.HTTPError(request.full_url, 429, 'Too Many Requests', {}, io.BytesIO(b'{}'))
        reader.opener = types.SimpleNamespace(open=opened)
        with patch.object(m.time, 'sleep') as sleep, contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(m.Stop, 'HTTP_429'):
            reader.read('cloudresourcemanager.googleapis.com', '/v1/projects/' + m.PROJECT)
        self.assertEqual(len(requests), 4)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [5, 10, 20])
        self.assertEqual(reader.last_diagnostic['attempt'], 4)
        self.assertTrue(all(r.get_method() == 'GET' and '/v1/projects/' + m.PROJECT == urlsplit(r.full_url).path for r in requests))

    def test_long_retry_after_is_not_shortened_or_ignored(self):
        reader = m.Reader('PRIVATE_TOKEN')
        error = urllib.error.HTTPError('https://cloudresourcemanager.googleapis.com', 429, 'Too Many Requests',
                                       {'Retry-After': '120'}, io.BytesIO(b'{}'))
        reader.opener = types.SimpleNamespace(open=lambda *a, **k: (_ for _ in ()).throw(error))
        with patch.object(m.time, 'sleep') as sleep, self.assertRaisesRegex(m.Stop, 'HTTP_429'):
            reader.read('cloudresourcemanager.googleapis.com', '/v1/projects/' + m.PROJECT)
        sleep.assert_not_called()
        self.assertEqual(reader.last_diagnostic['retryAfterSeconds'], 120)
        self.assertEqual(m.retry_after_seconds('bad header'), 0)
        future = m.email.utils.format_datetime(m.dt.datetime.now(m.dt.timezone.utc) + m.dt.timedelta(seconds=120))
        self.assertGreater(m.retry_after_seconds(future), 60)

    def test_read_rpc_retry_rechecks_policy_and_cannot_become_a_document_write(self):
        reader = m.Reader('PRIVATE_TOKEN')
        calls = []

        def opened(request, **kwargs):
            calls.append(request)
            if len(calls) == 1:
                raise urllib.error.HTTPError(request.full_url, 503, 'Unavailable', {}, io.BytesIO(b'{}'))
            return io.BytesIO(b'{"collectionIds":[]}')
        reader.opener = types.SimpleNamespace(open=opened)
        with patch.object(m, 'allowed_request', wraps=m.allowed_request) as guard, patch.object(m.time, 'sleep'), contextlib.redirect_stdout(io.StringIO()):
            reader.read('firestore.googleapis.com', '/v1/' + m.DOCUMENTS + ':listCollectionIds', {'pageSize': 1000})
        self.assertEqual(guard.call_count, 2)
        self.assertTrue(all(r.get_method() == 'POST' and r.full_url.endswith(':listCollectionIds') for r in calls))
        self.assertTrue(all(json.loads(r.data) == {'pageSize': 1000} for r in calls))

    def test_http_refusal_identifies_api_reason_and_permission_without_secrets(self):
        raw = {'error': {'status': 'PERMISSION_DENIED', 'message': 'PRIVATE_TOKEN PRIVATE_ACCOUNT',
                        'details': [{'@type': 'type.googleapis.com/google.rpc.ErrorInfo',
                                     'reason': 'SERVICE_DISABLED', 'metadata': {'permission': 'resourcemanager.projects.get',
                                     'activationUrl': 'https://private.invalid/PRIVATE_TOKEN', 'principal': 'PRIVATE_ACCOUNT'}}]}}
        error = urllib.error.HTTPError('https://cloudresourcemanager.googleapis.com', 403, 'Forbidden', {}, io.BytesIO(json.dumps(raw).encode()))
        reader = m.Reader('PRIVATE_TOKEN')
        reader.opener = types.SimpleNamespace(open=lambda *args, **kwargs: (_ for _ in ()).throw(error))
        with self.assertRaisesRegex(m.Stop, 'HTTP_403'):
            reader.read('cloudresourcemanager.googleapis.com', '/v1/projects/' + m.PROJECT)
        self.assertEqual(reader.last_diagnostic, {'api': 'cloudresourcemanager.googleapis.com', 'operation': 'project.metadata',
                                               'quotaProjectId': m.PROJECT, 'attempt': 1,
                                               'httpStatus': 403, 'status': 'PERMISSION_DENIED', 'reasonCodes': ['SERVICE_DISABLED'],
                                               'permissions': ['resourcemanager.projects.get']})
        self.assertNotIn('PRIVATE', json.dumps(reader.last_diagnostic))

    def test_malformed_error_body_remains_private(self):
        reader = m.Reader('PRIVATE_TOKEN')
        reader.last_diagnostic = reader.diagnostic('firebaserules.googleapis.com', '/v1/projects/' + m.PROJECT + '/releases/cloud.firestore')
        error = urllib.error.HTTPError('https://firebaserules.googleapis.com', 403, 'Forbidden', {}, io.BytesIO(b'PRIVATE_HTML_ERROR'))
        reader.read_failure(error)
        self.assertEqual(reader.last_diagnostic['operation'], 'rules.release')
        self.assertEqual(reader.last_diagnostic['httpStatus'], 403)
        self.assertNotIn('PRIVATE', json.dumps(reader.last_diagnostic))

    def test_cloud_shell_report_contains_safe_diagnostic_and_no_token(self):
        before = Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                os.chdir(tmp)
                out = io.StringIO()
                result = types.SimpleNamespace(returncode=0, stdout='PRIVATE_TOKEN', stderr='PRIVATE_ERROR')
                reader = types.SimpleNamespace(last_diagnostic={'api': 'cloudbilling.googleapis.com', 'operation': 'billing.metadata', 'httpStatus': 403})
                with patch.object(m.subprocess, 'run', return_value=result), patch.object(m, 'Reader', return_value=reader), patch.object(m, 'export', side_effect=m.Stop('HTTP_403')), contextlib.redirect_stdout(out):
                    self.assertEqual(m.main(), 1)
                report = json.loads(Path('inventaire-verification.json').read_text())
                self.assertEqual(report['scriptVersion'], 3)
                self.assertEqual(report['diagnostic']['operation'], 'billing.metadata')
                self.assertNotIn('PRIVATE', out.getvalue() + json.dumps(report))
        finally:
            os.chdir(before)

    def test_request_policy_refuses_other_projects_and_every_write_rpc(self):
        bad = [('firestore.googleapis.com', '/v1/' + m.DOCUMENTS + ':commit', {'writes': []}),
               ('firestore.googleapis.com', '/v1/projects/other/databases/(default)/documents:listCollectionIds', {'pageSize': 1000}),
               ('firebaserules.googleapis.com', '/v1/projects/' + m.PROJECT + '/rulesets', {'source': {}}),
               ('cloudbilling.googleapis.com', '/v1/projects/' + m.PROJECT + '/billingInfo', {'billingAccountName': 'paid'}),
               ('example.test', '/v1/projects/' + m.PROJECT, None)]
        for args in bad:
            with self.subTest(args=args[:2]), self.assertRaises(m.Stop):
                m.allowed_request(*args)
        m.allowed_request('firestore.googleapis.com', '/v1/' + m.DOCUMENTS + ':listCollectionIds', {'pageSize': 1000})

    def test_snapshot_preserves_nested_documents_under_missing_parent(self):
        data = m.snapshot(Fake())
        self.assertEqual(len(data['documents']), 3)
        self.assertTrue(any('/missing-parent/nested/' in d['name'] for d in data['documents']))
        self.assertFalse(any(d['name'].endswith('/missing-parent') for d in data['documents']))

    def test_pagination_is_complete_and_repeated_token_is_refused(self):
        class Paged:
            def __init__(self, loop=False):
                self.calls = 0
                self.loop = loop

            def read(self, host, path, body=None):
                m.allowed_request(host, path, body)
                self.calls += 1
                if self.loop or self.calls == 1:
                    return {'documents': [{'fake': 1}], 'nextPageToken': 'next'}
                return {'documents': [{'fake': 2}]}
        path = '/v1/' + m.DOCUMENTS + '/products'
        self.assertEqual(list(m.pages(Paged(), path)), [{'fake': 1}, {'fake': 2}])
        with self.assertRaisesRegex(m.Stop, 'PAGINATION_LOOP'):
            list(m.pages(Paged(True), path))

    def test_foreign_document_is_refused_before_local_backup(self):
        fake = Fake()
        fake.documents[m.DOCUMENTS + '/products'][0]['name'] = 'projects/other/databases/(default)/documents/products/x'
        with self.assertRaisesRegex(m.Stop, 'DOCUMENT_SCOPE'):
            m.snapshot(fake)

    def test_complete_backup_readback_privacy_and_permissions(self):
        fake = Fake()
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            report = m.export(fake, folder)
            backup = json.loads((folder / 'sauvegarde-complete.json').read_bytes())
            self.assertEqual(report['status'], 'BACKUP_VERIFIED')
            self.assertEqual(report['location'], 'eur3')
            self.assertEqual(report['productModels']['legacy'], 1)
            self.assertEqual(report['otherOrNestedDocumentCount'], 1)
            self.assertTrue(report['migrationRequired'])
            self.assertFalse(report['migrationExecuted'])
            self.assertEqual(backup['checksum'], m.digest({k: v for k, v in backup.items() if k != 'checksum'}))
            self.assertEqual(stat.S_IMODE((folder / 'sauvegarde-complete.json').stat().st_mode), 0o600)
            self.assertIn('UNKNOWN_FIELD', json.dumps(backup))
            for secret in ['PRIVATE_UID', 'PRIVATE_PRODUCT', 'PRIVATE_NOTE', 'PRIVATE_SUBCOLLECTION']:
                self.assertNotIn(secret, json.dumps(report))
            self.assertTrue(all(body is None or path.endswith(':listCollectionIds') for _, path, body in fake.calls))

    def test_changes_during_backup_abort_without_complete_backup(self):
        fake = Fake()
        fake.changed = True
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(m.Stop, 'DATA_CHANGED'):
                m.export(fake, Path(tmp))
            self.assertFalse((Path(tmp) / 'sauvegarde-complete.json').exists())

    def test_billing_and_wrong_project_stop_before_data_reads(self):
        for key in ['billing', 'project']:
            fake = Fake()
            if key == 'billing':
                fake.billing = {'billingEnabled': True, 'billingAccountName': 'linked'}
            else:
                fake.project['projectId'] = 'other'
            with tempfile.TemporaryDirectory() as tmp, self.assertRaises(m.Stop):
                m.export(fake, Path(tmp))
            self.assertFalse(any('/documents' in path for _, path, _ in fake.calls))

    def test_quantities_are_checked_without_rounding(self):
        self.assertEqual(m.micros('1,25'), 1250000)
        self.assertEqual(m.micros(0.000001), 1)
        for value in [True, -1, float('nan'), '0.0000001', '1000001']:
            with self.subTest(value=value), self.assertRaises(m.Stop):
                m.micros(value)

    def test_unknown_schema_and_invalid_units_require_review(self):
        fake = Fake()
        fake.product['fields']['unit'] = string('')
        report = m.model_report(m.snapshot(fake))
        self.assertEqual(report['basicReviewIssues'], {'unit-review': 1})
        self.assertTrue(report['fullMigrationValidationStillRequired'])

    def test_existing_files_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'copy.json'
            m.write_private(path, {'first': True})
            with self.assertRaises(FileExistsError):
                m.write_private(path, {'replace': True})
            self.assertEqual(json.loads(path.read_text()), {'first': True})

    def test_authentication_failure_does_not_disclose_tokens_or_cli_errors(self):
        before = Path.cwd()
        try:
            with tempfile.TemporaryDirectory() as tmp:
                os.chdir(tmp)
                out = io.StringIO()
                result = types.SimpleNamespace(returncode=1, stdout='PRIVATE_TOKEN', stderr='PRIVATE_ERROR')
                with patch.object(m.subprocess, 'run', return_value=result), contextlib.redirect_stdout(out):
                    self.assertEqual(m.main(), 1)
                self.assertNotIn('PRIVATE', out.getvalue())
                report = json.loads(Path('inventaire-verification.json').read_text())
                self.assertEqual(report['error'], 'GOOGLE_SIGN_IN_REQUIRED')
        finally:
            os.chdir(before)


if __name__ == '__main__':
    unittest.main()
