#!/usr/bin/env python3

import importlib.util
import json
import os
import pathlib
import re
import stat
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location(
    "runtime_config", ROOT / "infra" / "runtime_config.py"
)
config_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(config_tool)


class RuntimeConfigTests(unittest.TestCase):
    def test_documented_runtime_yaml_examples(self):
        checked = 0
        for path in (ROOT / "docs" / "docs").rglob("*"):
            if path.suffix not in (".md", ".mdx"):
                continue
            examples = re.findall(
                r'```yaml title="/etc/towbar/towbar.yml"[^\n]*\n(.*?)\n```',
                path.read_text(),
                re.DOTALL,
            )
            for snippet in examples:
                with self.subTest(path=path.relative_to(ROOT)):
                    config = config_tool.yaml.load(
                        snippet, Loader=config_tool.UniqueLoader
                    )
                    config_tool.to_env({"version": 1, **config})
                checked += 1
        self.assertGreaterEqual(checked, 10)

    def test_supported_environment_inventory_is_complete(self):
        template = (ROOT / ".env.example").read_text()
        keys = set(
            re.findall(
                r"^#? ?((?:TOWBAR|NEXT_PUBLIC)_[A-Z0-9_]+|COMPOSE_PROFILES)=",
                template,
                re.MULTILINE,
            )
        )
        self.assertEqual(keys, set(config_tool.FIELDS) | {"COMPOSE_PROFILES"})

    def test_example_migrates_without_changing_effective_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env = root / "towbar.env"
            yml = root / "towbar.yml"
            env.write_text((ROOT / ".env.example").read_text())
            original = config_tool.parse_env(env)
            config_tool.migrate(env, yml, True)
            config_tool.migrate(env, yml, True)
            config_tool.render(yml, env)
            config_tool.compare(yml, env)
            self.assertEqual(
                config_tool.from_env(original),
                config_tool.from_env(config_tool.parse_env(env)),
            )
            self.assertEqual(
                (root / "towbar.env.legacy").read_text(),
                (ROOT / ".env.example").read_text(),
            )
            self.assertEqual(stat.S_IMODE(yml.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(env.stat().st_mode), 0o600)
            yml.write_text(yml.read_text().replace("port: 4021", "port: 4022"))
            with self.assertRaisesRegex(config_tool.ConfigError, "out of date"):
                config_tool.compare(yml, env)

    def test_all_optional_fields_and_nested_json_round_trip(self):
        values = {"COMPOSE_PROFILES": "local"}
        for key, (_, kind) in config_tool.FIELDS.items():
            if kind == "boolean":
                values[key] = "true"
            elif kind == "integer":
                values[key] = "12"
            elif kind == "json-object":
                values[key] = json.dumps({"example": ["one", "two"]})
            else:
                values[key] = "some-value"
        values["TOWBAR_INSTALL_MODE"] = "local"
        values["TOWBAR_APP_BASE_URL"] = "http://localhost:4021"
        values["TOWBAR_NOTIFICATION_CONFIG_JSON"] = json.dumps(
            {"providers": {}, "routes": []}
        )
        converted = config_tool.from_env(values)
        self.assertEqual(
            converted["notifications"]["routes"], []
        )
        self.assertEqual(
            config_tool.from_env(config_tool.to_env(converted)), converted
        )

    def test_secret_characters_survive_rendering(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            yml = root / "towbar.yml"
            env = root / "towbar.env"
            secret = "can't use $OTHER # this value"
            config = {
                "version": 1,
                "installation": {"mode": "local"},
                "security": {"internalHmacSecret": secret},
                "notifications": {
                    "enabled": True,
                    "providers": {
                        "webhook": [
                            {
                                "id": "ops",
                                "headers": {"Authorization": "Bearer $OTHER"},
                            }
                        ]
                    },
                    "routes": [],
                },
            }
            yml.write_text(config_tool.yaml.safe_dump(config))
            config_tool.render(yml, env)
            rendered = config_tool.parse_env(env)
            self.assertEqual(rendered["TOWBAR_INTERNAL_HMAC_SECRET"], secret)
            self.assertEqual(
                json.loads(rendered["TOWBAR_NOTIFICATION_CONFIG_JSON"]),
                {key: value for key, value in config["notifications"].items() if key != "enabled"},
            )

    def test_invalid_and_unknown_settings_fail_without_overwriting(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            env = root / "towbar.env"
            yml = root / "towbar.yml"
            env.write_text("TOWBAR_INSTALL_MODE=local\nCUSTOM_TOKEN=secret\n")
            with self.assertRaisesRegex(config_tool.ConfigError, "CUSTOM_TOKEN"):
                config_tool.migrate(env, yml, False)
            self.assertFalse(yml.exists())
            yml.write_text("version: 1\ninstallation:\n  mode: local\n  typo: secret\n")
            with self.assertRaisesRegex(config_tool.ConfigError, "installation.typo"):
                config_tool.read_yaml(yml)
            yml.write_text("version: 1\ninstallation:\n  mode: local\n  mode: public\n")
            with self.assertRaisesRegex(config_tool.ConfigError, "duplicate"):
                config_tool.read_yaml(yml)

    def test_installation_url_can_change_after_an_interrupted_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            yml = root / "towbar.yml"
            env = root / "towbar.env"
            env.write_text((ROOT / ".env.example").read_text())
            config_tool.migrate(env, yml, False)
            config_tool.set_installation(
                yml, "public", "https://towbar.example.com", "towbar.example.com", 1
            )
            config_tool.render(yml, env)
            values = config_tool.parse_env(env)
            self.assertEqual(values["COMPOSE_PROFILES"], "public")
            self.assertEqual(values["TOWBAR_GATEWAY_DOMAIN"], "towbar.example.com")
            self.assertEqual(
                values["TOWBAR_GITLAB_OAUTH_REDIRECT_URI"],
                "https://towbar.example.com/v1/core/gitlab/oauth/callback",
            )


if __name__ == "__main__":
    unittest.main()
