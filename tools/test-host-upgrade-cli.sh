#!/usr/bin/env bash
# Isolated fixtures override functions and variables read by the sourced CLI.
# shellcheck disable=SC2030,SC2031,SC2034,SC2329
set -Eeuo pipefail
repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT
export TOWBAR_ROOT="$temporary_root/opt" TOWBAR_CONFIG_DIR="$temporary_root/etc"
# shellcheck source=../infra/towbar-cli/00-version.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/00-version.sh"
# shellcheck source=../infra/towbar-cli/00-runtime.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/00-runtime.sh"
# shellcheck disable=SC1091
# shellcheck source=../infra/towbar-cli/30-release.sh
source "$repository/infra/towbar-cli/30-release.sh"
# shellcheck disable=SC1091
# shellcheck source=../infra/towbar-cli/40-lifecycle.sh
source "$repository/infra/towbar-cli/40-lifecycle.sh"
# shellcheck disable=SC1091
# shellcheck source=../infra/towbar-cli/45-upgrade-service.sh
source "$repository/infra/towbar-cli/45-upgrade-service.sh"
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
source "$1/infra/towbar-cli/00-version.sh"
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

(
  unset TOWBAR_UPGRADE_JOB TOWBAR_UPGRADE_COMMIT
  release_dir="$temporary_root/compatible-release"
  mkdir -p "$release_dir/infra/upgrade-runner"
  printf '2\n' >"$release_dir/infra/upgrade-runner/protocol"
  TOWBAR_ROOT=/opt/towbar
  TOWBAR_CONFIG_DIR=/etc/towbar
  TOWBAR_BIN=/usr/local/bin/towbar
  TOWBAR_REPOSITORY=avgeek-inc/towbar
  systemctl() { [[ "$1" == list-units ]]; }
  host_upgrades_supported "$release_dir"
  TOWBAR_ROOT="$temporary_root/custom"
  if host_upgrades_supported "$release_dir"; then exit 1; fi
  TOWBAR_ROOT=/opt/towbar
  TOWBAR_REPOSITORY=example/fork
  if host_upgrades_supported "$release_dir"; then exit 1; fi
  TOWBAR_REPOSITORY=avgeek-inc/towbar
  printf '1\n' >"$release_dir/infra/upgrade-runner/protocol"
  if host_upgrades_supported "$release_dir"; then exit 1; fi
  printf '2\n' >"$release_dir/infra/upgrade-runner/protocol"
  systemctl() { return 1; }
  if host_upgrades_supported "$release_dir"; then exit 1; fi
)

(
  unset TOWBAR_UPGRADE_JOB TOWBAR_UPGRADE_COMMIT
  rm "$TOWBAR_CONFIG_DIR/upgrade-compose.yml"
  host_upgrades_supported() { return 0; }
  acquire_lock() { printf 'lock\n' >>"$temporary_root/setup-events"; }
  python3() { printf 'install\n' >>"$temporary_root/setup-events"; }
  systemctl() { printf '%s\n' "$*" >>"$temporary_root/setup-events"; }
  restart_release_locked() { printf 'restart\n' >>"$temporary_root/setup-events"; }
  enable_host_upgrades_after_upgrade "$temporary_root/release"
  printf 'install\nenable --now towbar-upgrade.service\nrestart\n' >"$temporary_root/expected-events"
  cmp "$temporary_root/setup-events" "$temporary_root/expected-events"

  # The upgrade already holds the CLI lock; setup must not acquire it again.
  touch "$TOWBAR_CONFIG_DIR/upgrade-compose.yml"
  enable_host_upgrades_after_upgrade "$temporary_root/release"
  cmp "$temporary_root/setup-events" "$temporary_root/expected-events"
  rm "$TOWBAR_CONFIG_DIR/upgrade-compose.yml"
  TOWBAR_UPGRADE_JOB=11111111-1111-4111-8111-111111111111
  enable_host_upgrades_after_upgrade "$temporary_root/release"
  cmp "$temporary_root/setup-events" "$temporary_root/expected-events"
  unset TOWBAR_UPGRADE_JOB

  python3() { return 1; }
  if enable_host_upgrades_after_upgrade "$temporary_root/release"; then exit 1; fi
  cmp "$temporary_root/setup-events" "$temporary_root/expected-events"
)

(
  unset TOWBAR_UPGRADE_JOB TOWBAR_UPGRADE_COMMIT
  rm -f "$TOWBAR_CONFIG_DIR/upgrade-compose.yml"
  upgraded_fixture="$temporary_root/upgraded-release"
  mkdir -p "$upgraded_fixture" "$TOWBAR_ROOT"
  host_upgrades_supported() { return 0; }
  acquire_lock() { printf 'lock\n' >>"$temporary_root/upgrade-events"; }
  download_release() { printf '%s\n' "$upgraded_fixture"; }
  migrate_runtime_config_path() { :; }
  generate_config() { CONFIG_CREATED=false; }
  prepare_runtime_config() { :; }
  validate_config_for() { :; }
  preflight_runtime_configuration() { :; }
  set_current_release() { ln -sfn "$1" "$CURRENT_LINK"; }
  compose_for() { :; }
  verify_running_release() { printf 'healthy\n' >>"$temporary_root/upgrade-events"; }
  install_cli_from_release() { printf 'cli-installed\n' >>"$temporary_root/upgrade-events"; }
  commit_runtime_config() { printf 'config-committed\n' >>"$temporary_root/upgrade-events"; }
  cleanup_installation_artifacts() { :; }
  python3() {
    printf 'runner-installed\n' >>"$temporary_root/upgrade-events"
    touch "$TOWBAR_CONFIG_DIR/upgrade-compose.yml"
  }
  systemctl() { printf '%s\n' "$*" >>"$temporary_root/upgrade-events"; }
  upgrade_release v2.0.18
  printf 'lock\nhealthy\ncli-installed\nconfig-committed\nrunner-installed\nenable --now towbar-upgrade.service\nhealthy\nconfig-committed\n' >"$temporary_root/expected-upgrade-events"
  cmp "$temporary_root/upgrade-events" "$temporary_root/expected-upgrade-events"
)

printf 'Host upgrade CLI pin, Compose override and automatic setup checks passed.\n'
