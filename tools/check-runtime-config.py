#!/usr/bin/env python3

import importlib.util
import pathlib
import re
import sys


root = pathlib.Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "runtime_config", root / "infra" / "runtime_config.py"
)
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)

injected = {
    "SOURCE_COMMIT",
    "TOWBAR_API_IMAGE",
    "TOWBAR_IMAGE_TAG",
    "TOWBAR_WEB_APP_IMAGE",
    "TOWBAR_WORKER_IMAGE",
}
compose = set(re.findall(r"\$\{([A-Z][A-Z0-9_]*)", (root / "docker-compose.yml").read_text()))
supported = set(config.FIELDS) | {"COMPOSE_PROFILES", "TOWBAR_GATEWAY_DOMAIN", "TOWBAR_GATEWAY_API_DOMAIN"}
expected = (compose - injected) | {"COMPOSE_PROFILES", "TOWBAR_INSTALL_MODE"}
missing = expected - supported
unused = supported - expected
if missing or unused:
    sys.exit(f"Runtime configuration mapping mismatch: missing={sorted(missing)}, unused={sorted(unused)}")
print(f"YAML configuration maps all {len(expected)} internal Compose settings.")
