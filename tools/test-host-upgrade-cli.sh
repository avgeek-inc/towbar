#!/usr/bin/env bash
set -Eeuo pipefail
repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT
export TOWBAR_ROOT="$temporary_root/opt" TOWBAR_CONFIG_DIR="$temporary_root/etc"
# shellcheck disable=SC1091
# shellcheck source=../infra/towbar-cli/00-runtime.sh
source "$repository/infra/towbar-cli/00-runtime.sh"
# shellcheck disable=SC1091
# shellcheck source=../infra/towbar-cli/30-release.sh
source "$repository/infra/towbar-cli/30-release.sh"
# shellcheck disable=SC1091
# shellcheck source=../infra/towbar-cli/40-lifecycle.sh
source "$repository/infra/towbar-cli/40-lifecycle.sh"
require_root() { :; }
require_linux() { :; }
require_runtime_tools() { :; }
validate_repository() { :; }
acquire_lock() { :; }
validate_version() { :; }
verify_release() { :; }
resolve_release_commit() { printf '%040d\n' 2; }
download_release() { touch "$temporary_root/unexpected-download"; }
export TOWBAR_UPGRADE_JOB=11111111-1111-4111-8111-111111111111
export TOWBAR_UPGRADE_COMMIT=1111111111111111111111111111111111111111
if (upgrade_release v2.0.17) >"$temporary_root/output" 2>&1; then
  printf 'Expected changed-commit rejection\n' >&2
  exit 1
fi
grep -q 'release commit changed after confirmation' "$temporary_root/output"
[[ ! -e "$temporary_root/unexpected-download" ]]
mkdir -p "$TOWBAR_CONFIG_DIR"
touch "$TOWBAR_CONFIG_DIR/upgrade-compose.yml"
env_value() { printf 'local\n'; }
metadata_value() { printf 'image@sha256:fixture\n'; }
docker() { printf '%s\n' "$@" >"$temporary_root/compose-arguments"; }
compose_for "$temporary_root/release" pinned-commit "$TOWBAR_ENV_FILE" config --quiet
grep -q "$TOWBAR_CONFIG_DIR/upgrade-compose.yml" "$temporary_root/compose-arguments"
for expected_status in 0 23; do
  set +e
  bash -s -- "$repository" "$expected_status" <<'BASH' >"$temporary_root/delegation-output" 2>&1
set -Eeuo pipefail
source "$1/infra/towbar-cli/00-runtime.sh"
source "$1/infra/towbar-cli/40-lifecycle.sh"
expected_status="$2"
require_root() { :; }
python3() { return "$expected_status"; }
unset TOWBAR_UPGRADE_JOB TOWBAR_UPGRADE_COMMIT
trap 'printf "Original exit trap preserved\n"' EXIT
upgrade_release v2.0.17
BASH
  actual_status=$?
  set -e
  [[ "$actual_status" -eq "$expected_status" ]]
  grep -q 'Original exit trap preserved' "$temporary_root/delegation-output"
done
printf 'Host upgrade CLI pin and Compose override checks passed.\n'
