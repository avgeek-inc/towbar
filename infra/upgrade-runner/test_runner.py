import http.client
import errno
import importlib.util
import json
from pathlib import Path
import socket
import struct
import tempfile
import threading
import time
import unittest
from unittest.mock import patch, Mock
import uuid

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('runner.py'))
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        installer = patch.object(r, 'install_current_runner')
        restarter = patch.object(r, 'restart_runner')
        self.install_runner = installer.start()
        self.restart_runner = restarter.start()
        self.addCleanup(installer.stop)
        self.addCleanup(restarter.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name)
        self.runner = r.Runner(self.directory)
        self.plan = {'id': str(uuid.uuid4()), 'currentVersion': 'v2.0.16', 'currentCommit': 'a' * 40,
                     'targetVersion': 'v2.0.17', 'commit': 'b' * 40, 'expiresAt': time.time() + 60}
        r.save(self.directory / 'plan.json', self.plan)
        self.body = {'planId': self.plan['id'], 'requestId': str(uuid.uuid4()), 'actorId': str(uuid.uuid4())}
        self.metadata = {'VERSION': 'v2.0.16', 'COMMIT': 'a' * 40}

    def tearDown(self):
        self.temp.cleanup()

    def start(self):
        with patch.object(r, 'metadata', return_value=self.metadata), patch.object(r.threading, 'Thread'):
            return self.runner.start(self.body)

    def test_version_and_request_validation(self):
        for target in ['latest', 'v2.0.17-rc.1', '../v2.0.17', 'v02.0.17', 'v2.0.17;id', 'v2.0.17\n', 42]:
            with self.assertRaises(ValueError):
                r.version(target)
        for body in [{**self.body, 'command': 'id'}, {**self.body, 'requestId': '../../tmp'}]:
            with self.assertRaises(ValueError):
                self.runner.start(body)

    def test_duplicate_is_idempotent_and_version_locked(self):
        first = self.start()
        duplicate = self.runner.start(self.body)
        self.assertEqual(first, duplicate)
        with self.assertRaises(ValueError):
            self.runner.start({**self.body, 'planId': str(uuid.uuid4())})
        self.assertEqual(first['targetVersion'], 'v2.0.17')
        self.assertEqual(first['commit'], 'b' * 40)

    def test_result_is_not_visible_until_durable(self):
        self.start()
        with patch.object(r, 'save', side_effect=OSError('disk full')):
            with self.assertRaises(OSError):
                self.runner.update(state='succeeded')
        self.assertEqual(self.runner.status()['job']['state'], 'checking')
        with self.assertRaises(ValueError):
            self.runner.ensure_idle()

    def test_initial_save_failure_never_starts_or_leaves_a_malformed_job(self):
        with patch.object(r, 'save', side_effect=OSError('disk full')), patch.object(r, 'metadata', return_value=self.metadata), patch.object(r.threading, 'Thread') as thread, patch.object(r.traceback, 'print_exc'):
            with self.assertRaises(OSError):
                self.runner.start(self.body)
            thread.assert_not_called()
            self.assertEqual(self.runner.job['state'], 'failed')
            self.assertIn('not started', self.runner.job['message'])
            self.assertEqual(self.runner.start(self.body)['state'], 'failed')
            with self.assertRaises(ValueError):
                self.runner.ensure_idle()

    def test_partial_initial_save_recovers_as_interrupted_without_execution(self):
        save = r.save
        def fail_archive(path, value):
            if path.name != 'job.json' or value['state'] == 'failed':
                raise OSError('disk full')
            save(path, value)
        with patch.object(r, 'save', side_effect=fail_archive), patch.object(r, 'metadata', return_value=self.metadata), patch.object(r.threading, 'Thread') as thread, patch.object(r.traceback, 'print_exc'):
            with self.assertRaises(OSError):
                self.runner.start(self.body)
            thread.assert_not_called()
        with patch.object(r.subprocess, 'Popen') as command:
            restarted = r.Runner(self.directory)
            self.assertEqual(restarted.job['state'], 'interrupted')
            self.assertEqual(restarted.start(self.body)['state'], 'interrupted')
            command.assert_not_called()

    def test_expired_and_changed_installations_are_rejected(self):
        self.metadata['COMMIT'] = 'c' * 40
        with self.assertRaises(ValueError):
            self.start()
        self.metadata['COMMIT'] = 'a' * 40
        self.plan['expiresAt'] = 0
        r.save(self.directory / 'plan.json', self.plan)
        with self.assertRaises(ValueError):
            self.start()

    def test_restart_is_interrupted_and_does_not_execute_again(self):
        self.start()
        with patch.object(r.subprocess, 'Popen') as process:
            restarted = r.Runner(self.directory)
            self.assertEqual(restarted.job['state'], 'interrupted')
            self.assertEqual(restarted.start(self.body)['state'], 'interrupted')
            process.assert_not_called()
        with self.assertRaises(ValueError):
            restarted.ensure_idle()

    def test_busy_work_unpauses_without_running_cli(self):
        self.start()
        with patch.object(r, 'pause', return_value=['Deployments: 1']), patch.object(r, 'unpause') as release, patch.object(r.subprocess, 'Popen') as process:
            self.runner.execute(self.plan)
            self.assertEqual(self.runner.job['state'], 'blocked')
            release.assert_called_once_with(self.body['requestId'])
            process.assert_not_called()

    def test_failure_keeps_admission_paused_and_retains_log(self):
        self.start()
        process = Mock(stdout=iter(['Applying the database schema\n', 'private-token=fixture-secret\n', 'Upgrade failed; restoring old services\n']))
        process.wait.return_value = 1
        with patch.object(r, 'pause', return_value=[]), patch.object(r, 'published_release'), patch.object(r, 'unpause') as release, patch.object(r.subprocess, 'Popen', return_value=process), patch.object(r.traceback, 'print_exc'):
            self.runner.execute(self.plan)
            self.assertEqual(self.runner.job['state'], 'failed')
            release.assert_not_called()
            self.assertEqual(self.runner.job['admission'], 'paused')
            self.assertIn('New deployments and operations remain paused', self.runner.job['message'])
            self.assertIn('applying database changes and restarting services (exit code 1)', self.runner.job['message'])
            self.assertNotIn('private-token', self.runner.job['message'])
            persisted = r.read(self.directory / 'job.json')
            self.assertEqual(persisted['message'], self.runner.job['message'])
            self.assertTrue((self.directory / (self.body['requestId'] + '.log')).exists())

    def test_failure_reasons_use_safe_stage_or_known_cause(self):
        scenarios = [
            ('release', RuntimeError('private-token=fixture-secret'), 'verifying the selected release'),
            ('process', OSError(errno.ENOSPC, 'private-token=fixture-secret'), 'not enough disk space'),
            ('health', None, 'checking service health (exit code 3)'),
            ('version', None, 'installed release does not match the selected version'),
        ]
        for scenario, cause, reason in scenarios:
            with self.subTest(scenario=scenario):
                self.start()
                process = Mock(stdout=iter(['Verifying the API\n']))
                process.wait.return_value = 3 if scenario == 'health' else 0
                with patch.object(r, 'pause', return_value=[]), patch.object(r, 'published_release', side_effect=cause if scenario == 'release' else None), patch.object(r.subprocess, 'Popen', side_effect=cause if scenario == 'process' else None, return_value=process), patch.object(r, 'metadata', return_value=self.metadata), patch.object(r, 'unpause') as release, patch.object(r.traceback, 'print_exc'):
                    self.runner.execute(self.plan)
                self.assertEqual(self.runner.job['state'], 'failed')
                self.assertEqual(self.runner.job['admission'], 'paused')
                self.assertIn(reason, self.runner.job['message'])
                self.assertNotIn('private-token', self.runner.job['message'])
                release.assert_not_called()

    def test_success_uses_only_pinned_cli_and_resumes(self):
        self.start()
        process = Mock(stdout=iter(['Verifying the API\n']))
        process.wait.return_value = 0
        with patch.object(r, 'pause', return_value=[]), patch.object(r, 'published_release'), patch.object(r, 'unpause') as release, patch.object(r, 'metadata', return_value={'VERSION': 'v2.0.17', 'COMMIT': 'b' * 40}), patch.object(r.subprocess, 'Popen', return_value=process) as command:
            self.runner.execute(self.plan)
            self.assertEqual(command.call_args.args[0], [r.CLI, 'upgrade', 'v2.0.17'])
            self.assertEqual(command.call_args.kwargs['env']['TOWBAR_UPGRADE_COMMIT'], 'b' * 40)
            self.assertNotIn('shell', command.call_args.kwargs)
            self.assertEqual(self.runner.job['state'], 'succeeded')
            release.assert_called_once()
            self.install_runner.assert_called_once()
            self.restart_runner.assert_called_once()

    def test_restart_only_after_target_install_and_durable_success(self):
        self.start()
        process = Mock(stdout=iter([]))
        process.wait.return_value = 0
        sequence = []
        self.install_runner.side_effect = lambda: sequence.append('install')
        def restart():
            self.assertEqual(r.read(self.directory / 'job.json')['state'], 'succeeded')
            self.assertEqual(sequence, ['install', 'unpause'])
            with self.assertRaises(ValueError):
                self.runner.ensure_idle()
            sequence.append('restart')
        self.restart_runner.side_effect = restart
        with patch.object(r, 'pause', return_value=[]), patch.object(r, 'published_release'), patch.object(r, 'unpause', side_effect=lambda _: sequence.append('unpause')), patch.object(r, 'metadata', return_value={'VERSION': 'v2.0.17', 'COMMIT': 'b' * 40}), patch.object(r.subprocess, 'Popen', return_value=process):
            self.runner.execute(self.plan)
        self.assertEqual(sequence, ['install', 'unpause', 'restart'])

    def test_runner_install_failure_keeps_admission_paused(self):
        self.start()
        process = Mock(stdout=iter([]))
        process.wait.return_value = 0
        self.install_runner.side_effect = OSError('installation failed')
        with patch.object(r, 'pause', return_value=[]), patch.object(r, 'published_release'), patch.object(r, 'unpause') as release, patch.object(r, 'metadata', return_value={'VERSION': 'v2.0.17', 'COMMIT': 'b' * 40}), patch.object(r.subprocess, 'Popen', return_value=process), patch.object(r.traceback, 'print_exc'):
            self.runner.execute(self.plan)
        self.assertEqual(self.runner.job['state'], 'failed')
        self.assertEqual(self.runner.job['admission'], 'paused')
        self.assertIn('updating the upgrade service', self.runner.job['message'])
        release.assert_not_called()
        self.restart_runner.assert_not_called()

    def test_restart_failure_reports_open_admission_and_blocks_another_upgrade(self):
        self.start()
        process = Mock(stdout=iter([]))
        process.wait.return_value = 0
        self.restart_runner.side_effect = OSError('systemd unavailable')
        with patch.object(r, 'pause', return_value=[]), patch.object(r, 'published_release'), patch.object(r, 'unpause'), patch.object(r, 'metadata', return_value={'VERSION': 'v2.0.17', 'COMMIT': 'b' * 40}), patch.object(r.subprocess, 'Popen', return_value=process), patch.object(r.traceback, 'print_exc'):
            self.runner.execute(self.plan)
        self.assertEqual(self.runner.job['state'], 'failed')
        self.assertEqual(self.runner.job['admission'], 'open')
        self.assertIn('service could not restart', self.runner.job['message'])
        with self.assertRaises(ValueError):
            self.runner.ensure_idle()

    def assert_final_persistence_failure(self, persistent):
        self.start()
        process = Mock(stdout=iter([]))
        process.wait.return_value = 0
        save = r.save
        def failing_save(path, value):
            # Fail the second write, after the per-request record was saved.
            if (value.get('state') == 'succeeded' and path.name == 'job.json') or (persistent and value.get('state') == 'failed'):
                raise OSError('disk full')
            save(path, value)
        with patch.object(r, 'pause', return_value=[]), patch.object(r, 'published_release'), patch.object(r, 'unpause') as release, patch.object(r, 'metadata', return_value={'VERSION': 'v2.0.17', 'COMMIT': 'b' * 40}), patch.object(r.subprocess, 'Popen', return_value=process), patch.object(r, 'save', side_effect=failing_save), patch.object(r.traceback, 'print_exc'):
            self.runner.execute(self.plan)
            release.assert_called_once()
            job = self.runner.status()['job']
            self.assertEqual(job['state'], 'failed')
            self.assertEqual(job['admission'], 'open')
            self.assertIn('Deployments and operations can start again', job['message'])
            self.assertNotIn('stays paused', job['message'])
            self.assertEqual(self.runner.start(self.body), job)
            with self.assertRaises(ValueError):
                self.runner.ensure_idle()
        with patch.object(r.subprocess, 'Popen') as command:
            restarted = r.Runner(self.directory)
            self.assertIn(restarted.job['state'], {'failed', 'interrupted'})
            self.assertNotIn('stays paused', restarted.job['message'])
            with self.assertRaises(ValueError):
                restarted.ensure_idle()
            with patch.object(r, 'run'), patch.object(r, 'blockers', return_value=[]), patch.object(r, 'unpause'):
                self.assertEqual(restarted.resume()['job']['state'], 'recovered')
            command.assert_not_called()

    def test_final_save_failure_reports_open_admission_and_requires_recovery(self):
        self.assert_final_persistence_failure(False)

    def test_unwritable_failure_status_still_blocks_retry_and_recovers_after_restart(self):
        self.assert_final_persistence_failure(True)

    def test_unhealthy_or_busy_host_cannot_resume(self):
        self.start()
        with self.assertRaises(ValueError):
            self.runner.resume()
        self.runner.update(state='failed')
        with patch.object(r, 'run'), patch.object(r, 'blockers', return_value=['Unresolved activity']), patch.object(r, 'unpause') as release:
            with self.assertRaises(ValueError):
                self.runner.resume()
            release.assert_not_called()

    def test_recovery_save_failure_does_not_claim_admission_is_paused(self):
        self.start()
        self.runner.update(state='failed', admission='paused')
        save = r.save
        def failing_save(path, value):
            if value.get('state') == 'recovered':
                raise OSError('disk full')
            save(path, value)
        with patch.object(r, 'run'), patch.object(r, 'blockers', return_value=[]), patch.object(r, 'unpause'), patch.object(r, 'save', side_effect=failing_save):
            with self.assertRaises(OSError):
                self.runner.resume()
        self.assertEqual(self.runner.job['state'], 'failed')
        self.assertEqual(self.runner.job['admission'], 'open')
        self.assertIn('Deployments and operations can start again', self.runner.job['message'])

    def test_socket_requires_token_and_root_for_recovery(self):
        endpoint = str(self.directory / 'socket')
        with r.Server(endpoint, r.Handler) as server:
            server.runner = self.runner
            server.token = 'secret'
            server.allow_resume = lambda _connection: False
            threading.Thread(target=server.serve_forever, daemon=True).start()
            def request(path, token, body=None):
                connection = http.client.HTTPConnection('localhost')
                connection.sock = socket.socket(socket.AF_UNIX)
                connection.sock.connect(endpoint)
                try:
                    connection.request('GET' if body is None else 'POST', path, body=json.dumps(body) if body is not None else None, headers={'Authorization': 'Bearer ' + token})
                except BrokenPipeError:
                    # An early authorization rejection can close before the body is sent.
                    pass
                response = connection.getresponse()
                response.read()
                connection.close()
                return response.status
            self.assertEqual(request('/status', 'wrong'), 403)
            self.assertEqual(request('/plan', 'wrong', {'targetVersion': 'v2.0.17'}), 403)
            self.assertEqual(request('/jobs', 'wrong', self.body), 403)
            self.assertEqual(request('/status', 'secret'), 200)
            self.assertEqual(request('/resume', 'secret', {}), 404)
            self.assertEqual(request('/exec', 'secret', {'command': 'id'}), 404)
            server.shutdown()

    def test_group_access_does_not_authorize_recovery(self):
        connection = Mock()
        with patch.object(r.socket, 'SO_PEERCRED', 17, create=True):
            for uid in [1001, 2000]:
                connection.getsockopt.return_value = struct.pack('3i', 123, uid, 43210)
                self.assertFalse(r.peer_is_root(connection))
            connection.getsockopt.return_value = struct.pack('3i', 123, 0, 0)
            self.assertTrue(r.peer_is_root(connection))


if __name__ == '__main__':
    unittest.main()
