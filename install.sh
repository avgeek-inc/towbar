#!/usr/bin/env bash
set -Eeuo pipefail

TOWBAR_REPOSITORY="${TOWBAR_REPOSITORY:-avgeek-inc/towbar}"
INSTALLER_VERSION="v2.0.11"
TOWBAR_CLI_URL="${TOWBAR_CLI_URL:-https://raw.githubusercontent.com/$TOWBAR_REPOSITORY/$INSTALLER_VERSION/infra/towbar}"
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

if [[ -t 1 && -r /dev/tty && -w /dev/tty ]]; then
  exec env \
    TOWBAR_REPOSITORY="$TOWBAR_REPOSITORY" \
    TOWBAR_BIN="$TOWBAR_BIN" \
    "$TOWBAR_BIN" install </dev/tty
fi

exec env \
  TOWBAR_NON_INTERACTIVE=1 \
  TOWBAR_REPOSITORY="$TOWBAR_REPOSITORY" \
  TOWBAR_BIN="$TOWBAR_BIN" \
  "$TOWBAR_BIN" install
