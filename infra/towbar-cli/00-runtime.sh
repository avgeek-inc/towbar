#!/usr/bin/env bash
set -Eeuo pipefail

CLI_VERSION="2.0.13"
CLI_RELEASE="v$CLI_VERSION"
TOWBAR_ROOT="${TOWBAR_ROOT:-/opt/towbar}"
TOWBAR_CONFIG_DIR="${TOWBAR_CONFIG_DIR:-/etc/towbar}"
TOWBAR_ENV_FILE="${TOWBAR_ENV_FILE:-$TOWBAR_CONFIG_DIR/towbar.env}"
TOWBAR_YAML_FILE="${TOWBAR_YAML_FILE:-$TOWBAR_CONFIG_DIR/towbar.yml}"
TOWBAR_COMMITTED_ENV_FILE="$TOWBAR_ENV_FILE"
TOWBAR_PENDING_ENV_FILE=""
TOWBAR_REPOSITORY="${TOWBAR_REPOSITORY:-avgeek-inc/towbar}"
TOWBAR_BIN="${TOWBAR_BIN:-/usr/local/bin/towbar}"
RELEASES_DIR="$TOWBAR_ROOT/releases"
CURRENT_LINK="$TOWBAR_ROOT/current"
VERSION_FILE="$TOWBAR_ROOT/VERSION"
LOCK_FILE="${TOWBAR_LOCK_FILE:-/var/lock/towbar.lock}"

STYLE_RESET=""
STYLE_BOLD=""
STYLE_MUTED=""
STYLE_YELLOW=""
STYLE_GREEN=""
STYLE_RED=""
INSTALL_FAILURE_CONTEXT=""

setup_styles() {
  if [[ -t 1 && -z "${NO_COLOR:-}" && "${TERM:-dumb}" != dumb ]]; then
    STYLE_RESET=$'\033[0m'
    STYLE_BOLD=$'\033[1m'
    STYLE_MUTED=$'\033[38;5;245m'
    STYLE_YELLOW=$'\033[38;5;214m'
    STYLE_GREEN=$'\033[38;5;78m'
    STYLE_RED=$'\033[38;5;203m'
  fi
}

setup_styles

log() {
  printf 'Towbar: %s\n' "$*"
}

fail() {
  printf '%sTowbar: %s%s\n' "$STYLE_RED" "$*" "$STYLE_RESET" >&2
  exit 1
}

ui_brand() {
  if gum_available; then
    gum style \
      --border rounded \
      --border-foreground 214 \
      --padding "0 2" \
      --margin "1 0" \
      --bold \
      "TOWBAR" \
      "Self-hosted deployments, ready on your infrastructure."
    printf '\n'
    return
  fi
  printf '\n%s%sTOWBAR%s\n' "$STYLE_BOLD" "$STYLE_YELLOW" "$STYLE_RESET"
  printf '%sSelf-hosted deployments, ready on your infrastructure.%s\n\n' \
    "$STYLE_MUTED" "$STYLE_RESET"
}

ui_heading() {
  printf '%s%s%s\n' "$STYLE_BOLD" "$1" "$STYLE_RESET"
}

ui_success_heading() {
  printf '%s%s%s%s\n' "$STYLE_BOLD" "$STYLE_GREEN" "$1" "$STYLE_RESET"
}

ui_note() {
  printf '%s%s%s\n' "$STYLE_MUTED" "$1" "$STYLE_RESET"
}

ui_step() {
  printf '%s✓%s  %s\n' "$STYLE_GREEN" "$STYLE_RESET" "$1"
}

ui_pending_step() {
  printf '%s○%s  %s\n' "$STYLE_YELLOW" "$STYLE_RESET" "$1"
}

ui_failure_step() {
  printf '%s✗%s  %s\n' "$STYLE_RED" "$STYLE_RESET" "$1" >&2
}

interactive_terminal() {
  [[ -t 0 && -t 1 && "${TOWBAR_NON_INTERACTIVE:-0}" != 1 ]]
}

gum_available() {
  interactive_terminal && command -v gum >/dev/null 2>&1
}
