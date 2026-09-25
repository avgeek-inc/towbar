config_helper_for() {
  local release_dir="$1" helper="$1/infra/runtime_config.py"
  [[ -f "$helper" ]] || fail "$release_dir does not support YAML runtime configuration"
  printf '%s\n' "$helper"
}

ensure_yaml_tooling() {
  command -v python3 >/dev/null || fail "Python 3 is required for YAML configuration"
  if python3 -c 'import yaml' >/dev/null 2>&1; then
    return
  fi
  command -v apt-get >/dev/null || fail "install python3-yaml to use YAML configuration"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install --yes python3-yaml
  python3 -c 'import yaml' >/dev/null || fail "python3-yaml is unavailable"
}

prepare_runtime_config() {
  local release_dir="$1" helper
  helper="$(config_helper_for "$release_dir")"
  ensure_yaml_tooling
  TOWBAR_CONFIG_HELPER="$helper"
  if [[ ! -f "$TOWBAR_YAML_FILE" ]]; then
    [[ -f "$TOWBAR_COMMITTED_ENV_FILE" ]] || fail "runtime configuration is missing"
    if [[ -f "$VERSION_FILE" ]]; then
      python3 "$helper" migrate \
        --env "$TOWBAR_COMMITTED_ENV_FILE" --yaml "$TOWBAR_YAML_FILE" --preserve-legacy
    else
      python3 "$helper" migrate \
        --env "$TOWBAR_COMMITTED_ENV_FILE" --yaml "$TOWBAR_YAML_FILE"
    fi
    ui_step "Converted runtime configuration to $TOWBAR_YAML_FILE"
  fi
  TOWBAR_PENDING_ENV_FILE="$(mktemp "$TOWBAR_CONFIG_DIR/.towbar.env.XXXXXX")"
  trap 'discard_runtime_config' EXIT
  python3 "$helper" render --yaml "$TOWBAR_YAML_FILE" --env "$TOWBAR_PENDING_ENV_FILE"
  TOWBAR_ENV_FILE="$TOWBAR_PENDING_ENV_FILE"
}

discard_runtime_config() {
  if [[ -n "$TOWBAR_PENDING_ENV_FILE" ]]; then
    rm -f "$TOWBAR_PENDING_ENV_FILE"
    TOWBAR_PENDING_ENV_FILE=""
  fi
  TOWBAR_ENV_FILE="$TOWBAR_COMMITTED_ENV_FILE"
}

commit_runtime_config() {
  [[ -n "$TOWBAR_PENDING_ENV_FILE" ]] || return 0
  mv -f "$TOWBAR_PENDING_ENV_FILE" "$TOWBAR_COMMITTED_ENV_FILE"
  TOWBAR_PENDING_ENV_FILE=""
  TOWBAR_ENV_FILE="$TOWBAR_COMMITTED_ENV_FILE"
}
