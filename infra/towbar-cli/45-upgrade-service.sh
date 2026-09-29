host_upgrades_supported() {
  local release_dir="$1"
  [[ "$TOWBAR_ROOT" == /opt/towbar && "$TOWBAR_CONFIG_DIR" == /etc/towbar && "$TOWBAR_BIN" == /usr/local/bin/towbar && "$TOWBAR_REPOSITORY" == avgeek-inc/towbar ]] || return 1
  [[ -f "$release_dir/infra/upgrade-runner/protocol" && "$(cat "$release_dir/infra/upgrade-runner/protocol")" == 2 ]] || return 1
  command -v python3 >/dev/null && command -v systemctl >/dev/null || return 1
  systemctl list-units --no-legend >/dev/null 2>&1
}

install_host_upgrade_service() {
  local release_dir="$1"
  python3 "$release_dir/infra/upgrade-runner/install.py" || return 1
  systemctl enable --now towbar-upgrade.service || return 1
}

enable_host_upgrades_after_upgrade() {
  local release_dir="$1"
  [[ -z "${TOWBAR_UPGRADE_JOB:-}" && ! -f "$TOWBAR_CONFIG_DIR/upgrade-compose.yml" ]] || return 0
  host_upgrades_supported "$release_dir" || return 0
  ui_pending_step "Enabling upgrades from System Health"
  install_host_upgrade_service "$release_dir" || return 1
  restart_release_locked
  ui_step "Upgrades from System Health are enabled"
}

upgrade_service_command() {
  require_root upgrade-service
  require_linux
  require_runtime_tools
  [[ "$TOWBAR_ROOT" == /opt/towbar && "$TOWBAR_CONFIG_DIR" == /etc/towbar && "$TOWBAR_BIN" == /usr/local/bin/towbar && "$TOWBAR_REPOSITORY" == avgeek-inc/towbar ]] ||
    fail "host upgrades require the standard upstream CLI installation paths"
  local release_dir version commit
  release_dir="$(current_release_dir)"
  case "${1:-}" in
    enable)
      [[ -f "$release_dir/infra/upgrade-runner/protocol" ]] || fail "upgrade this installation using the CLI before enabling host upgrades"
      command -v systemctl >/dev/null || fail "systemd is required"
      command -v python3 >/dev/null || fail "Python 3 is required"
      [[ ! -f /.dockerenv && ! -f /run/.containerenv ]] || fail "run this command on the host"
      acquire_lock
      if systemctl is-active --quiet towbar-upgrade.service; then
        fail "wait for any upgrade to finish, then stop towbar-upgrade.service before re-enabling it"
      fi
      install_host_upgrade_service "$release_dir"
      restart_release_locked
      ;;
    plan)
      version="${2:-}"
      validate_version "$version"
      acquire_lock
      verify_release "$version"
      commit="$(resolve_release_commit "$version")"
      release_dir="$(download_release "$version" "$commit")"
      [[ "$(cat "$release_dir/infra/upgrade-runner/protocol" 2>/dev/null)" == 2 ]] || fail "this release requires a manual host upgrade"
      jq -n --arg version "$version" --arg commit "$commit" '{version:$version,commit:$commit}'
      ;;
    resume)
      shift
      [[ $# -eq 1 && "$1" == --acknowledge-recovery ]] || fail "inspect sudo towbar doctor and the host upgrade log, then run sudo towbar upgrade-service resume --acknowledge-recovery"
      python3 /usr/local/lib/towbar-upgrade/runner.py --resume
      ;;
    *) fail "usage: towbar upgrade-service enable | resume --acknowledge-recovery" ;;
  esac
}
