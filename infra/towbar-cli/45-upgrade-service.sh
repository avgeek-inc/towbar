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
      if systemctl is-active --quiet towbar-upgrade.service; then
        fail "wait for any upgrade to finish, then stop towbar-upgrade.service before re-enabling it"
      fi
      python3 "$release_dir/infra/upgrade-runner/install.py"
      systemctl enable --now towbar-upgrade.service
      restart_release
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
