import io
import json
import unittest
from unittest.mock import patch
import runner


class DistributionTests(unittest.TestCase):
    def release(self, **changes):
        return {'version': 'v2.0.30', 'commit': 'a' * 40, 'validated': True, **changes}

    def fetch(self, release):
        return io.BytesIO(json.dumps(release).encode())

    def test_only_validated_owned_domain_metadata_is_accepted(self):
        with patch.object(runner.urllib.request, 'urlopen', return_value=self.fetch(self.release())) as request:
            self.assertEqual(runner.published_release('v2.0.30')['commit'], 'a' * 40)
            self.assertEqual(request.call_args.args[0].full_url, runner.DISTRIBUTION_URL + '/releases/v2.0.30/release.json')
        for changes in [{'validated': False}, {'version': 'v2.0.31'}, {'commit': 'not-a-commit'}]:
            with self.subTest(changes=changes), patch.object(runner.urllib.request, 'urlopen', return_value=self.fetch(self.release(**changes))):
                with self.assertRaises(ValueError):
                    runner.published_release('v2.0.30')

    def test_plan_rejects_commit_change_between_metadata_and_cli(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as root:
            broker = runner.Runner(Path(root))
            with patch.object(runner, 'metadata', return_value={'VERSION': 'v2.0.29', 'COMMIT': 'b' * 40}), patch.object(runner, 'published_release', return_value=self.release()), patch.object(runner, 'run', return_value=json.dumps({'version': 'v2.0.30', 'commit': 'c' * 40})):
                with self.assertRaises(ValueError):
                    broker.plan('v2.0.30')
                self.assertFalse((Path(root) / 'plan.json').exists())
