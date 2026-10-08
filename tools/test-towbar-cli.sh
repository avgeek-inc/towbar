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

# shellcheck source=../infra/towbar-cli/00-version.sh
# shellcheck disable=SC1091
source "$repository/infra/towbar-cli/00-version.sh"
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
generate_config "$repository"
[[ "$CONFIG_CREATED" == true ]]
postgres_password="$(env_value "$TOWBAR_ENV_FILE" TOWBAR_POSTGRES_PASSWORD)"
runtime_password="$(env_value "$TOWBAR_ENV_FILE" TOWBAR_DATABASE_RUNTIME_PASSWORD)"
hmac_secret="$(env_value "$TOWBAR_ENV_FILE" TOWBAR_INTERNAL_HMAC_SECRET)"
[[ "$postgres_password" =~ ^[0-9a-f]{64}$ ]]
[[ "$runtime_password" =~ ^[0-9a-f]{64}$ ]]
[[ "$hmac_secret" =~ ^[0-9a-f]{64}$ ]]
[[ "$postgres_password" != "$runtime_password" && "$postgres_password" != "$hmac_secret" && "$runtime_password" != "$hmac_secret" ]]
[[ "$(env_value "$TOWBAR_ENV_FILE" TOWBAR_CREDENTIALS_KEY | openssl base64 -d -A | wc -c | tr -d ' ')" == 32 ]]

printf 'TOWBAR_INSTALL_MODE=local\n' >"$TOWBAR_ENV_FILE"
generate_config "$temporary_root/release"
[[ "$CONFIG_CREATED" == false ]]

verify_public_https "$temporary_root/release" test-commit
CONFIG_CREATED=false
rehearse_public_https_restart "$temporary_root/release" test-commit

printf 'Towbar CLI no-op guards passed.\n'
