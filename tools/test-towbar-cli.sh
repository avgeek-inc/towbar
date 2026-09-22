#!/usr/bin/env bash
set -Eeuo pipefail

repository="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temporary_root="$(mktemp -d)"
trap 'rm -rf "$temporary_root"' EXIT

# Referenced by the sourced CLI modules.
# shellcheck disable=SC2034
TOWBAR_ROOT="$temporary_root/opt"
TOWBAR_CONFIG_DIR="$temporary_root/etc"
TOWBAR_ENV_FILE="$TOWBAR_CONFIG_DIR/towbar.env"

# shellcheck source=../infra/towbar-cli/00-runtime.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/00-runtime.sh"
# shellcheck source=../infra/towbar-cli/10-onboarding.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/10-onboarding.sh"
# shellcheck source=../infra/towbar-cli/30-release.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/30-release.sh"
# shellcheck source=../infra/towbar-cli/40-lifecycle.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/40-lifecycle.sh"

# Referenced by verify_public_prerequisites.
# shellcheck disable=SC2034
INSTALL_MODE=local
verify_public_prerequisites

install -d "$TOWBAR_CONFIG_DIR"
printf 'TOWBAR_INSTALL_MODE=local\n' >"$TOWBAR_ENV_FILE"
generate_config "$temporary_root/release"
[[ "$CONFIG_CREATED" == false ]]

verify_public_https "$temporary_root/release" test-commit
CONFIG_CREATED=false
rehearse_public_https_restart "$temporary_root/release" test-commit

printf 'Towbar CLI no-op guards passed.\n'
