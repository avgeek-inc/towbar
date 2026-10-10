import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import upgrade_permissions as permissions

spec = importlib.util.spec_from_file_location('upgrade_install', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'config'
        self.config.mkdir()

    def test_future_release_replaces_runner_and_unit_with_target_code(self):
        library = self.root / 'library'
        unit = self.root / 'service'
        for version in ['v2.0.17', 'v2.0.18']:
            release = self.root / version
            source = release / 'infra/upgrade-runner'
            source.mkdir(parents=True)
            (source / 'protocol').write_text('2\n')
            (source / 'runner.py').write_text(f'RELEASE = "{version}"\n')
            (source / 'repository_identity.py').write_text(f'RELEASE = "{version}"\n')
            (source / 'upgrade_permissions.py').write_text(f'RELEASE = "{version}"\n')
            (source / 'towbar-upgrade.service').write_text(f'# {version}\n')
            (source / 'compose.yml').write_bytes(Path(__file__).with_name('compose.yml').read_bytes())
            with patch.object(installer, 'ensure_group', return_value=43210):
                installer.install_release(release, library, self.config, unit)
            self.assertEqual((library / 'runner.py').read_bytes(), (source / 'runner.py').read_bytes())
            self.assertEqual(unit.read_bytes(), (source / 'towbar-upgrade.service').read_bytes())
            compose = (self.config / 'upgrade-compose.yml').read_text()
            self.assertIn('group_add:\n      - "43210"', compose)
            self.assertNotIn('1001', compose)
            self.assertNotIn('@TOWBAR_UPGRADE_GID@', compose)
            self.assertEqual(stat.S_IMODE((self.config / 'upgrade-compose.yml').stat().st_mode), 0o600)

    def test_entrypoint_installs_the_verified_release_it_was_run_from(self):
        target = self.root / 'verified-target'
        with patch.object(installer, '__file__', str(target / 'infra/upgrade-runner/install.py')), patch.object(installer.os, 'geteuid', return_value=0), patch.object(installer, 'install_release') as install, patch.object(installer.subprocess, 'run') as reload:
            installer.main()
            install.assert_called_once_with(target.resolve())
            reload.assert_called_once_with(['systemctl', 'daemon-reload'], check=True, timeout=30)

    def test_existing_host_group_is_not_adopted(self):
        unrelated = SimpleNamespace(gr_name='towbar-upgrade', gr_gid=1001, gr_mem=['unrelated'])
        dedicated = SimpleNamespace(gr_name='towbar-upgrade-abcd1234', gr_gid=43210, gr_mem=[])
        groups = {'towbar-upgrade': unrelated}
        def get_group(name):
            if name not in groups:
                raise KeyError(name)
            return groups[name]
        def create(args, **kwargs):
            self.assertEqual(args, ['groupadd', '--system', dedicated.gr_name])
            groups[dedicated.gr_name] = dedicated
        path = self.config / 'upgrade-group.json'
        with patch.object(permissions.grp, 'getgrnam', side_effect=get_group), patch.object(permissions.grp, 'getgrall', return_value=[unrelated, dedicated]), patch.object(permissions.pwd, 'getpwall', return_value=[]), patch.object(permissions.secrets, 'token_hex', return_value='abcd1234'), patch.object(permissions.subprocess, 'run', side_effect=create):
            self.assertEqual(permissions.ensure_group(path), 43210)
        self.assertEqual(json.loads(path.read_text()), {'name': dedicated.gr_name, 'gid': 43210})
        self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_saved_group_rejects_host_users_and_changed_or_shared_gid(self):
        path = self.config / 'upgrade-group.json'
        path.write_text(json.dumps({'name': 'towbar-upgrade', 'gid': 43210}))
        os.chmod(path, 0o600)
        group = SimpleNamespace(gr_name='towbar-upgrade', gr_gid=43210, gr_mem=[])
        info = SimpleNamespace(st_uid=0, st_mode=stat.S_IFREG | 0o600)
        with patch.object(permissions.os, 'fstat', return_value=info), patch.object(permissions.grp, 'getgrnam', return_value=group), patch.object(permissions.grp, 'getgrall', return_value=[group]), patch.object(permissions.pwd, 'getpwall', return_value=[]) as users:
            self.assertEqual(permissions.ensure_group(path), 43210)
            group.gr_mem = ['unrelated']
            with self.assertRaises(ValueError):
                permissions.runtime_group(path)
            group.gr_mem = []
            users.return_value = [SimpleNamespace(pw_gid=43210)]
            with self.assertRaises(ValueError):
                permissions.runtime_group(path)
            users.return_value = []
            group.gr_gid = 1001
            with self.assertRaises(ValueError):
                permissions.runtime_group(path)
            group.gr_gid = 43210
            with patch.object(permissions.grp, 'getgrall', return_value=[group, SimpleNamespace(gr_name='another', gr_gid=43210)]):
                with self.assertRaises(ValueError):
                    permissions.runtime_group(path)
            info.st_mode = stat.S_IFREG | 0o644
            with self.assertRaises(ValueError):
                permissions.runtime_group(path)
            info.st_mode = stat.S_IFREG | 0o600
            info.st_uid = 1001
            with self.assertRaises(ValueError):
                permissions.runtime_group(path)

    def test_runtime_rotates_old_token_and_uses_only_dedicated_group(self):
        runtime = self.root / 'run'
        runtime.mkdir()
        (runtime / 'token').write_text('old-token')
        with patch.object(permissions.os, 'chown') as chown, patch.object(permissions.os, 'fchown') as fchown:
            token = permissions.prepare_runtime(runtime, 43210)
        chown.assert_called_once_with(runtime, 0, 43210)
        self.assertEqual(fchown.call_args.args[1:], (0, 43210))
        self.assertNotEqual(token, 'old-token')
        self.assertEqual((runtime / 'token').read_text(), token)
        self.assertEqual(stat.S_IMODE(runtime.stat().st_mode), 0o750)
        self.assertEqual(stat.S_IMODE((runtime / 'token').stat().st_mode), 0o640)


if __name__ == '__main__':
    unittest.main()
