#!/usr/bin/env bash
# Generated from infra/install.sh.in and package.json; run pnpm cli:build.
set -Eeuo pipefail

TOWBAR_REPOSITORY="avgeek-oss/towbar"
TOWBAR_DISTRIBUTION_URL="https://oss.avgeek.ltd/towbar"
INSTALLER_VERSION="v2.0.34"
TOWBAR_CLI_URL="$TOWBAR_DISTRIBUTION_URL/releases/$INSTALLER_VERSION/towbar"
TOWBAR_BIN="${TOWBAR_BIN:-/usr/local/bin/towbar}"

fail() {
  printf 'Towbar installer: %s\n' "$*" >&2
  exit 1
}

((EUID == 0)) || fail "run this installer as root"
[[ "$(uname -s)" == Linux ]] || fail "Towbar installation supports Linux hosts"
command -v curl >/dev/null || fail "curl is required"
command -v sha256sum >/dev/null || fail "sha256sum is required"

temporary_dir="$(mktemp -d)"
cleanup() { rm -rf "$temporary_dir"; }
trap cleanup EXIT
curl --fail --silent --show-error --location --retry 4 --retry-all-errors \
  --proto '=https' --proto-redir '=https' --tlsv1.2 \
  "$TOWBAR_DISTRIBUTION_URL/releases/$INSTALLER_VERSION/SHA256SUMS" --output "$temporary_dir/SHA256SUMS"
expected="$(awk '$2 == "towbar" && $1 ~ /^[a-f0-9]+$/ && length($1) == 64 { print $1 }' "$temporary_dir/SHA256SUMS")"
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail "release does not contain a CLI checksum"
curl --fail --silent --show-error --location --retry 4 --retry-all-errors \
  --proto '=https' --proto-redir '=https' --tlsv1.2 \
  "$TOWBAR_CLI_URL" --output "$temporary_dir/towbar"
printf '%s  %s\n' "$expected" "$temporary_dir/towbar" | sha256sum --check --status || fail "CLI checksum verification failed"
bash -n "$temporary_dir/towbar"
install -o root -g root -m 0755 "$temporary_dir/towbar" "$TOWBAR_BIN"
trap - EXIT
cleanup

if [[ -t 1 && -r /dev/tty && -w /dev/tty ]]; then
  exec env TOWBAR_REPOSITORY="$TOWBAR_REPOSITORY" TOWBAR_BIN="$TOWBAR_BIN" \
    "$TOWBAR_BIN" install </dev/tty
fi
exec env TOWBAR_NON_INTERACTIVE=1 TOWBAR_REPOSITORY="$TOWBAR_REPOSITORY" TOWBAR_BIN="$TOWBAR_BIN" \
  "$TOWBAR_BIN" install
