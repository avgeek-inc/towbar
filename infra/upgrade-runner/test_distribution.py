import io
import json
import unittest
from unittest.mock import patch
import runner


class DistributionTests(unittest.TestCase):
    def release(self, **changes):
        return {'schemaVersion': 1, 'version': 'v2.0.30', 'commit': 'a' * 40, 'validated': True, **changes}

    def fetch(self, release):
        return io.BytesIO(json.dumps(release).encode())

    def github(self, **changes):
        return {'tag_name': 'v2.0.30', 'draft': False, 'prerelease': False, 'body': 'GitHub release notes', **changes}

    def test_published_github_release_and_validated_assets_are_required(self):
        with patch.object(runner.urllib.request, 'urlopen', side_effect=[self.fetch(self.github()), self.fetch(self.release())]) as request:
            release = runner.published_release('v2.0.30')
            self.assertEqual(release['commit'], 'a' * 40)
            self.assertEqual(release['body'], 'GitHub release notes')
            self.assertEqual(request.call_args_list[0].args[0].full_url, runner.RELEASES_API_URL + '/tags/v2.0.30')
            self.assertEqual(request.call_args_list[1].args[0].full_url, runner.REPOSITORY_URL + '/releases/download/v2.0.30/release.json')
        for changes in [{'validated': False}, {'version': 'v2.0.31'}, {'commit': 'not-a-commit'}, {'schemaVersion': 2}]:
            with self.subTest(changes=changes), patch.object(runner.urllib.request, 'urlopen', side_effect=[self.fetch(self.github()), self.fetch(self.release(**changes))]):
                with self.assertRaises(ValueError):
                    runner.published_release('v2.0.30')

    def test_drafts_prereleases_and_mismatched_tags_are_rejected_before_download(self):
        for changes in [{'draft': True}, {'prerelease': True}, {'tag_name': 'v2.0.31'}, {'tag_name': 'v2.0.30-rc.1'}]:
            with self.subTest(changes=changes), patch.object(runner.urllib.request, 'urlopen', return_value=self.fetch(self.github(**changes))) as request:
                with self.assertRaises(ValueError):
                    runner.published_release('v2.0.30')
                self.assertEqual(request.call_count, 1)

    def test_plan_rejects_commit_change_between_metadata_and_cli(self):
        import tempfile
        from pathlib import Path
        with tempfile.TemporaryDirectory() as root:
            broker = runner.Runner(Path(root))
            with patch.object(runner, 'metadata', return_value={'VERSION': 'v2.0.29', 'COMMIT': 'b' * 40}), patch.object(runner, 'published_release', return_value=self.release()), patch.object(runner, 'run', return_value=json.dumps({'version': 'v2.0.30', 'commit': 'c' * 40})):
                with self.assertRaises(ValueError):
                    broker.plan('v2.0.30')
                self.assertFalse((Path(root) / 'plan.json').exists())
