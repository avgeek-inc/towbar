#!/usr/bin/env bash
set -Eeuo pipefail

TOWBAR_REPOSITORY="${TOWBAR_REPOSITORY:-avgeek-inc/towbar}"
TOWBAR_VERSION="${TOWBAR_VERSION:-latest}"
TOWBAR_CLI_URL="${TOWBAR_CLI_URL:-https://raw.githubusercontent.com/$TOWBAR_REPOSITORY/main/infra/towbar}"
TOWBAR_BIN="${TOWBAR_BIN:-/usr/local/bin/towbar}"

fail() {
  printf 'Towbar installer: %s\n' "$*" >&2
  exit 1
}

((EUID == 0)) || fail "run this installer as root"
[[ "$(uname -s)" == Linux ]] || fail "Towbar installation supports Linux hosts"
[[ "$TOWBAR_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] ||
  fail "TOWBAR_REPOSITORY must be a GitHub owner/repository pair"
command -v curl >/dev/null || fail "curl is required"

temporary_cli="$(mktemp)"
cleanup() {
  rm -f "$temporary_cli"
}
trap cleanup EXIT

curl \
  --fail \
  --silent \
  --show-error \
  --location \
  --retry 4 \
  --retry-all-errors \
  --proto '=https' \
  --tlsv1.2 \
  "$TOWBAR_CLI_URL" \
  --output "$temporary_cli"
bash -n "$temporary_cli"
install -o root -g root -m 0755 "$temporary_cli" "$TOWBAR_BIN"
trap - EXIT
cleanup

exec env \
  TOWBAR_REPOSITORY="$TOWBAR_REPOSITORY" \
  TOWBAR_BIN="$TOWBAR_BIN" \
  "$TOWBAR_BIN" install "$TOWBAR_VERSION"
