#!/usr/bin/env bash
set -Eeuo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

TOWBAR_ROOT="$temporary_root/opt"
TOWBAR_CONFIG_DIR="$temporary_root/etc"
TOWBAR_ENV_FILE="$TOWBAR_CONFIG_DIR/towbar.env"
TOWBAR_YAML_FILE="$TOWBAR_CONFIG_DIR/towbar.yml"

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

prepare_runtime_config "$release_dir"
[[ -f "$TOWBAR_YAML_FILE" && -f "$TOWBAR_COMMITTED_ENV_FILE.legacy" ]]
python3 "$release_dir/infra/runtime_config.py" compare \
  --yaml "$TOWBAR_YAML_FILE" --env "$TOWBAR_ENV_FILE"
commit_runtime_config
python3 "$release_dir/infra/runtime_config.py" compare \
  --yaml "$TOWBAR_YAML_FILE" --env "$TOWBAR_COMMITTED_ENV_FILE"

printf 'Towbar CLI YAML migration passed.\n'
