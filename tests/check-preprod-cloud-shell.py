import importlib.util
import io
import json
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('audit', Path(__file__).resolve().parents[1] / 'scripts/check_preprod_cloud_shell.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class FakeReader:
    def __init__(self, change=None):
        self.calls = []
        self.change = change or {}

    def read(self, host, path, body=None):
        self.calls.append((host, path, body))
        path = path.split('?')[0]
        for ending, data in self.change.items():
            if path.endswith(ending):
                return data
        if path.endswith('/billingInfo'):
            return {'billingEnabled': False, 'billingAccountName': ''}
        if path.endswith('/databases/(default)'):
            return {'name': f'projects/{audit.PROJECT}/databases/(default)', 'locationId': 'europe-west6', 'freeTier': True}
        if path.endswith('/releases/cloud.firestore'):
            return {'rulesetName': f'projects/{audit.PROJECT}/rulesets/fixture-1'}
        if '/rulesets/' in path:
            return {'source': {'files': [{'content': audit.DENY}]}}
        if path.endswith('/documents:listCollectionIds'):
            return {'collectionIds': []}
        if '/webApps/' in path and path.endswith('/config'):
            return {'projectId': audit.PROJECT, 'appId': audit.APP, 'apiKey': 'FAKE_PUBLIC_KEY'}
        if path.endswith('/config'):
            return {'signIn': {'anonymous': {'enabled': True}}, 'notification': {'secret': 'DO_NOT_EXPORT'}}
        return {'projectId': audit.PROJECT, 'projectNumber': audit.NUMBER, 'displayName': 'DO_NOT_EXPORT'}

    def pages(self, host, path, key):
        self.calls.append((host, path, None))
        if key == 'apps':
            return [{'appId': audit.APP, 'displayName': 'DO_NOT_EXPORT'}]
        if key == 'users':
            return [{'email': 'DO_NOT_EXPORT', 'localId': 'DO_NOT_EXPORT'}]
        return []


class AuditTests(unittest.TestCase):
    def test_success_and_redaction(self):
        fake = FakeReader()
        result = audit.inspect(fake)
        self.assertTrue(all(v['status'] == 'READ' for v in result.values()))
        self.assertTrue(result['rules']['value']['denyAllExactWhitespaceOnly'])
        self.assertEqual(result['authUsers']['value']['count'], 1)
        text = json.dumps(result)
        self.assertNotIn('DO_NOT_EXPORT', text)
        self.assertNotIn('FAKE_PUBLIC_KEY', text)
        for host, path, body in fake.calls:
            self.assertIn('/projects/' + audit.PROJECT, path)
            if body is not None:
                self.assertTrue(path.endswith('/documents:listCollectionIds'))

    def test_wrong_project_stops(self):
        fake = FakeReader({'/projects/' + audit.PROJECT: {'projectId': 'other', 'projectNumber': audit.NUMBER}})
        self.assertEqual(audit.inspect(fake)['project']['status'], 'STOP')
        self.assertEqual(len(fake.calls), 1)

    def test_billing_stops(self):
        fake = FakeReader({'/billingInfo': {'billingEnabled': True}})
        self.assertEqual(audit.inspect(fake)['gate']['status'], 'STOP')
        self.assertEqual(len(fake.calls), 2)

    def test_region_stops(self):
        fake = FakeReader({'/databases/(default)': {'name': f'projects/{audit.PROJECT}/databases/(default)', 'locationId': 'other', 'freeTier': True}})
        self.assertEqual(audit.inspect(fake)['gate']['status'], 'STOP')
        self.assertEqual(len(fake.calls), 3)

    def test_cross_project_ruleset_not_fetched(self):
        fake = FakeReader({'/releases/cloud.firestore': {'rulesetName': 'projects/other/rulesets/fixture'}})
        self.assertEqual(audit.inspect(fake)['rules']['error'], 'RULESET_TARGET_REFUSED')
        self.assertFalse(any('/rulesets/' in path for _, path, _ in fake.calls))

    def test_request_boundaries_before_network(self):
        reader = audit.Reader('FICTIONAL_TOKEN')
        reader.opener = None
        for host, path, body in [
            ('other.example', f'/v1/projects/{audit.PROJECT}', None),
            ('firestore.googleapis.com', '/v1/projects/other/databases/(default)', None),
            ('firestore.googleapis.com', f'/v1/projects/{audit.PROJECT}/databases/(default)/documents', {}),
        ]:
            with self.assertRaises(RuntimeError):
                reader.read(host, path, body)

    def test_redirect_refused(self):
        self.assertIsNone(audit.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.example'))

    def test_users_request_excludes_passwords_and_identity_details(self):
        fake = FakeReader()
        audit.inspect(fake)
        requests = [path for host, path, _ in fake.calls if '/accounts:batchGet' in path]
        self.assertEqual(requests, [f'/v1/projects/{audit.PROJECT}/accounts:batchGet?fields=users(localId),nextPageToken'])

    def test_auth_user_pagination_parameter(self):
        reader = audit.Reader('FICTIONAL_TOKEN')
        paths = []
        def read(host, path):
            paths.append(path)
            return {'users': [{}], **({'nextPageToken': 'fixture'} if len(paths) == 1 else {})}
        reader.read = read
        self.assertEqual(len(reader.pages('identitytoolkit.googleapis.com', f'/v1/projects/{audit.PROJECT}/accounts:batchGet?fields=users(localId),nextPageToken', 'users')), 2)
        self.assertTrue(paths[1].endswith('&nextPageToken=fixture'))

    def test_403_uses_targeted_gcloud_read(self):
        fake = FakeReader()
        original = fake.read
        def read(host, path, body=None):
            if path.endswith('/billingInfo'):
                raise audit.ReadFailure('HTTP_403', {'reason': 'SERVICE_DISABLED'})
            return original(host, path, body)
        fake.read = read
        data = {'name': f'projects/{audit.PROJECT}/billingInfo', 'projectId': audit.PROJECT,
                'billingEnabled': False, 'billingAccountName': ''}
        completed = audit.subprocess.CompletedProcess([], 0, json.dumps(data), '')
        with patch.object(audit.subprocess, 'run', return_value=completed) as command:
            results = audit.inspect(fake)
        self.assertEqual(results['billing']['readSource'], 'gcloud billing projects describe')
        self.assertEqual(results['billing']['value'], {'billingEnabled': False, 'billingAccountLinked': False})
        self.assertIn('rules', results)
        self.assertEqual(command.call_args.args[0], ['gcloud', 'billing', 'projects', 'describe', audit.PROJECT, '--format=json'])
        self.assertEqual(command.call_args.kwargs['stdin'], audit.subprocess.DEVNULL)

    def test_403_and_cli_refusal_still_stop(self):
        fake = FakeReader()
        original = fake.read
        def read(host, path, body=None):
            if path.endswith('/billingInfo'):
                raise audit.ReadFailure('HTTP_403')
            return original(host, path, body)
        fake.read = read
        with patch.object(audit.subprocess, 'run', return_value=audit.subprocess.CompletedProcess([], 1, '', 'PRIVATE_ERROR_NOT_EXPORTED')):
            results = audit.inspect(fake)
        self.assertEqual(results['gate']['status'], 'STOP')
        self.assertNotIn('rules', results)
        self.assertNotIn('PRIVATE_ERROR_NOT_EXPORTED', json.dumps(results))

    def test_billing_from_wrong_project_is_refused(self):
        with patch.object(audit.Reader, 'read', side_effect=audit.ReadFailure('HTTP_403')):
            with patch.object(audit.subprocess, 'run', return_value=audit.subprocess.CompletedProcess([], 0, '{"projectId":"other"}', '')):
                with self.assertRaisesRegex(audit.ReadFailure, 'BILLING_TARGET_NOT_CONFIRMED'):
                    audit.read_billing(audit.Reader('FICTIONAL_TOKEN'))

    def test_billing_enabled_never_triggers_fallback(self):
        with patch.object(audit.subprocess, 'run') as command:
            result = audit.inspect(FakeReader({'/billingInfo': {'billingEnabled': True}}))
        self.assertEqual(result['gate']['status'], 'STOP')
        command.assert_not_called()

    def test_http_diagnostic_does_not_export_raw_message_or_metadata(self):
        body = {'error': {'message': 'DO_NOT_EXPORT', 'details': [
            {'@type': 'type.googleapis.com/google.rpc.ErrorInfo', 'reason': 'SERVICE_DISABLED',
             'metadata': {'service': 'cloudbilling.googleapis.com', 'consumer': 'DO_NOT_EXPORT'}}]}}
        error = audit.urllib.error.HTTPError('https://cloudbilling.googleapis.com/', 403, 'Forbidden', {}, io.BytesIO(json.dumps(body).encode()))
        reader = audit.Reader('FICTIONAL_TOKEN')
        with patch.object(reader.opener, 'open', side_effect=error):
            with self.assertRaises(audit.ReadFailure) as caught:
                reader.read('cloudbilling.googleapis.com', f'/v1/projects/{audit.PROJECT}/billingInfo')
        self.assertEqual(str(caught.exception), 'HTTP_403')
        self.assertEqual(caught.exception.details, {'reason': 'SERVICE_DISABLED', 'service': 'cloudbilling.googleapis.com'})

    def test_field_overrides_use_official_filtered_query(self):
        fake = FakeReader()
        audit.inspect(fake)
        paths = [path for host, path, _ in fake.calls if '/fields?' in path]
        self.assertEqual(len(paths), 1)
        query = audit.urllib.parse.parse_qs(audit.urllib.parse.urlsplit(paths[0]).query)
        self.assertEqual(query['filter'], ['indexConfig.usesAncestorConfig=false OR ttlConfig:*'])


if __name__ == '__main__':
    unittest.main()
