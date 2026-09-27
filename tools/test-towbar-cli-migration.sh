#!/usr/bin/env bash
set -Eeuo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

TOWBAR_ROOT="$temporary_root/opt"
TOWBAR_CONFIG_DIR="$temporary_root/etc"
TOWBAR_ENV_FILE="$TOWBAR_CONFIG_DIR/towbar.env"
TOWBAR_YAML_FILE="$TOWBAR_CONFIG_DIR/config.yml"

# shellcheck source=../infra/towbar-cli/00-runtime.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/00-runtime.sh"
# shellcheck source=../infra/towbar-cli/15-config.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/15-config.sh"

release_dir="$temporary_root/release"
install -d "$TOWBAR_CONFIG_DIR" "$TOWBAR_ROOT" "$release_dir/infra"
cp "$repository/.env.example" "$TOWBAR_ENV_FILE"
cp "$repository/infra/runtime_config.py" "$release_dir/infra/runtime_config.py"
printf '2.0.11\n' >"$VERSION_FILE"
[[ "$(TOWBAR_CONFIG_DIR="$TOWBAR_CONFIG_DIR" "$repository/infra/towbar" config path)" == "$TOWBAR_ENV_FILE" ]]

prepare_runtime_config "$release_dir"
[[ -f "$TOWBAR_YAML_FILE" && -f "$TOWBAR_COMMITTED_ENV_FILE.legacy" ]]
[[ "$(TOWBAR_CONFIG_DIR="$TOWBAR_CONFIG_DIR" "$repository/infra/towbar" config path)" == "$TOWBAR_YAML_FILE" ]]
python3 "$release_dir/infra/runtime_config.py" compare \
  --yaml "$TOWBAR_YAML_FILE" --env "$TOWBAR_ENV_FILE"
commit_runtime_config
python3 "$release_dir/infra/runtime_config.py" compare \
  --yaml "$TOWBAR_YAML_FILE" --env "$TOWBAR_COMMITTED_ENV_FILE"

mv "$TOWBAR_YAML_FILE" "$TOWBAR_LEGACY_YAML_FILE"
cp "$TOWBAR_LEGACY_YAML_FILE" "$temporary_root/expected-config.yml"
[[ "$(TOWBAR_CONFIG_DIR="$TOWBAR_CONFIG_DIR" "$repository/infra/towbar" config path)" == "$TOWBAR_LEGACY_YAML_FILE" ]]
prepare_runtime_config "$release_dir"
[[ -f "$TOWBAR_YAML_FILE" && ! -e "$TOWBAR_LEGACY_YAML_FILE" ]]
cmp "$TOWBAR_YAML_FILE" "$temporary_root/expected-config.yml"
python3 - "$TOWBAR_YAML_FILE" <<'PY'
import os
import stat
import sys

assert stat.S_IMODE(os.stat(sys.argv[1]).st_mode) == 0o600
PY
python3 "$release_dir/infra/runtime_config.py" compare \
  --yaml "$TOWBAR_YAML_FILE" --env "$TOWBAR_ENV_FILE"
commit_runtime_config

cp "$TOWBAR_YAML_FILE" "$TOWBAR_LEGACY_YAML_FILE"
if (migrate_runtime_config_path) >"$temporary_root/conflict.log" 2>&1; then
  printf 'Towbar CLI accepted conflicting runtime configuration files.\n' >&2
  exit 1
fi
[[ -f "$TOWBAR_YAML_FILE" && -f "$TOWBAR_LEGACY_YAML_FILE" ]]
rm "$TOWBAR_LEGACY_YAML_FILE"

# A failed upgrade must leave the previous CLI's configuration path usable.
mv "$TOWBAR_YAML_FILE" "$TOWBAR_LEGACY_YAML_FILE"
# shellcheck source=../infra/towbar-cli/40-lifecycle.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/40-lifecycle.sh"
require_root() { :; }
require_linux() { :; }
require_runtime_tools() { :; }
validate_repository() { :; }
acquire_lock() { :; }
validate_version() { :; }
verify_release() { :; }
resolve_release_commit() { printf '%040d\n' 1; }
download_release() { printf '%s\n' "$release_dir"; }
generate_config() { fail "Simulated upgrade failure"; }
if (upgrade_release v2.0.15) >"$temporary_root/upgrade-failure.log" 2>&1; then
  printf 'Towbar CLI accepted a simulated failed upgrade.\n' >&2
  exit 1
fi
[[ -f "$TOWBAR_LEGACY_YAML_FILE" && ! -e "$TOWBAR_YAML_FILE" ]]

printf 'Towbar CLI YAML migration passed.\n'
