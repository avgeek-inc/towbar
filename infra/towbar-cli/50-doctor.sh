doctor_record() {
  local status="$1" message="$2" detail="${3:-}"

  case "$status" in
    pass)
      DOCTOR_PASS_COUNT=$((DOCTOR_PASS_COUNT + 1))
      ui_step "$message"
      ;;
    warn)
      DOCTOR_WARN_COUNT=$((DOCTOR_WARN_COUNT + 1))
      ui_pending_step "$message"
      ;;
    fail)
      DOCTOR_FAIL_COUNT=$((DOCTOR_FAIL_COUNT + 1))
      ui_failure_step "$message"
      ;;
  esac
  if [[ -n "$detail" ]]; then
    ui_note "   $detail"
  fi
}

doctor_check_host() {
  local os_id architecture memory_kib disk_kib disk_gib command_name
  os_id="$(awk -F= '$1 == "ID" { value = $2; gsub(/\"/, "", value); print value; exit }' /etc/os-release 2>/dev/null || true)"
  case "$os_id" in
    ubuntu | debian)
      doctor_record pass "Supported Linux distribution" "$os_id"
      ;;
    *)
      doctor_record fail "Unsupported Linux distribution" "Towbar supports Ubuntu and Debian; detected ${os_id:-unknown}."
      ;;
  esac

  architecture="$(uname -m)"
  case "$architecture" in
    x86_64 | aarch64 | arm64)
      doctor_record pass "Supported host architecture" "$architecture"
      ;;
    *)
      doctor_record warn "Unverified host architecture" "$architecture"
      ;;
  esac

  for command_name in curl docker git jq openssl tar; do
    if command -v "$command_name" >/dev/null 2>&1; then
      doctor_record pass "$command_name is available"
    else
      doctor_record fail "$command_name is missing"
    fi
  done

  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    doctor_record pass "Docker Engine is reachable" "$(docker version --format '{{.Server.Version}}' 2>/dev/null || true)"
  else
    doctor_record fail "Docker Engine is not reachable" "Start Docker, then rerun sudo towbar doctor."
  fi
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    doctor_record pass "Docker Compose v2 is available" "$(docker compose version --short 2>/dev/null || true)"
  else
    doctor_record fail "Docker Compose v2 is unavailable"
  fi

  disk_kib="$(df -Pk "$TOWBAR_ROOT" 2>/dev/null | awk 'NR == 2 { print $4 }')"
  if [[ "$disk_kib" =~ ^[0-9]+$ ]]; then
    disk_gib="$(awk -v kib="$disk_kib" 'BEGIN { printf "%.1f", kib / 1048576 }')"
    if ((disk_kib < 2097152)); then
      doctor_record fail "Host disk space is critically low" "$disk_gib GiB available. Free at least 2 GiB before operating Towbar."
    elif ((disk_kib < 10485760)); then
      doctor_record warn "Host disk space is low" "$disk_gib GiB available; 10 GiB or more is recommended for builds and upgrades."
    else
      doctor_record pass "Host disk space is available" "$disk_gib GiB free"
    fi
  else
    doctor_record warn "Host disk space could not be measured"
  fi

  memory_kib="$(awk '/^MemTotal:/ { print $2; exit }' /proc/meminfo 2>/dev/null || true)"
  if [[ "$memory_kib" =~ ^[0-9]+$ ]]; then
    if ((memory_kib < 1048576)); then
      doctor_record fail "Host memory is below 1 GiB" "Towbar may not start reliably on this host."
    elif ((memory_kib < 2097152)); then
      doctor_record warn "Host memory is below 2 GiB" "Builds and concurrent workflows may be constrained."
    else
      doctor_record pass "Host memory is available" "$(awk -v kib="$memory_kib" 'BEGIN { printf "%.1f GiB", kib / 1048576 }')"
    fi
  else
    doctor_record warn "Host memory could not be measured"
  fi

  if command -v timedatectl >/dev/null 2>&1 && \
    [[ "$(timedatectl show --property=NTPSynchronized --value 2>/dev/null || true)" == yes ]]; then
    doctor_record pass "System clock is synchronized"
  else
    doctor_record warn "System clock synchronization was not confirmed" "TLS and signed requests require an accurate clock."
  fi
}

format_kibibytes() {
  awk -v kib="$1" 'BEGIN {
    if (kib >= 1048576) printf "%.1f GiB", kib / 1048576;
    else if (kib >= 1024) printf "%.1f MiB", kib / 1024;
    else printf "%d KiB", kib;
  }'
}

doctor_check_disk_usage() {
  local release_kib=0 image_bytes=0 volume_kib=0 repository image_id size mountpoint volume
  local -A seen_images=()

  release_kib="$(du -sk "$RELEASES_DIR" 2>/dev/null | awk '{ print $1 }')"
  if [[ "$release_kib" =~ ^[0-9]+$ ]]; then
    doctor_record pass "Release storage measured" "$(format_kibibytes "$release_kib") in $RELEASES_DIR"
  else
    doctor_record warn "Release storage could not be measured"
  fi

  while read -r repository image_id; do
    is_towbar_application_repository "$repository" || continue
    [[ -z "${seen_images[$image_id]:-}" ]] || continue
    seen_images[$image_id]=1
    size="$(docker image inspect --format '{{.Size}}' "$image_id" 2>/dev/null || true)"
    [[ "$size" =~ ^[0-9]+$ ]] && image_bytes=$((image_bytes + size))
  done < <(docker image ls --no-trunc --format '{{.Repository}} {{.ID}}' 2>/dev/null | sort -u)
  doctor_record pass "Towbar application image storage measured" \
    "$(format_kibibytes $((image_bytes / 1024))) apparent size across ${#seen_images[@]} images"

  while IFS= read -r volume; do
    [[ -n "$volume" ]] || continue
    mountpoint="$(docker volume inspect --format '{{.Mountpoint}}' "$volume" 2>/dev/null || true)"
    [[ -d "$mountpoint" ]] || continue
    size="$(du -sk "$mountpoint" 2>/dev/null | awk '{ print $1 }')"
    [[ "$size" =~ ^[0-9]+$ ]] && volume_kib=$((volume_kib + size))
  done < <(docker volume ls --filter label=com.docker.compose.project=towbar --quiet 2>/dev/null)
  doctor_record pass "Towbar volume storage measured" "$(format_kibibytes "$volume_kib")"
}

doctor_check_config() {
  local release_dir="$1" ownership mode app_url
  if [[ ! -f "$TOWBAR_ENV_FILE" ]]; then
    doctor_record fail "Runtime configuration is missing" "$TOWBAR_ENV_FILE"
    return
  fi

  ownership="$(stat -c '%U:%G' "$TOWBAR_ENV_FILE" 2>/dev/null || true)"
  mode="$(stat -c '%a' "$TOWBAR_ENV_FILE" 2>/dev/null || true)"
  if [[ "$ownership" == root:root && "$mode" == 600 ]]; then
    doctor_record pass "Runtime configuration is protected" "$TOWBAR_ENV_FILE is owned by root:root with mode 600."
  else
    doctor_record fail "Runtime configuration permissions are unsafe" "Expected root:root mode 600; found ${ownership:-unknown} mode ${mode:-unknown}."
  fi

  if (validate_config_for "$release_dir") >/dev/null 2>&1; then
    app_url="$(env_value "$TOWBAR_ENV_FILE" TOWBAR_APP_BASE_URL)"
    doctor_record pass "Runtime configuration is valid" "$DOCTOR_MODE mode at $app_url"
  else
    doctor_record fail "Runtime configuration is invalid" "Run sudo towbar config validate for the exact error."
  fi
}

doctor_check_services() {
  local release_dir="$1" commit="$2" gateway_service="$3"
  local service container_id health_status restart_count
  local -a services=(postgres temporal temporal-ui api worker web-app "$gateway_service")

  for service in "${services[@]}"; do
    container_id="$(compose_for "$release_dir" "$commit" "$TOWBAR_ENV_FILE" ps -q "$service" 2>/dev/null || true)"
    if [[ -z "$container_id" ]]; then
      doctor_record fail "$service is not running"
      continue
    fi
    health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$container_id" 2>/dev/null || true)"
    if [[ "$health_status" == healthy || "$health_status" == running ]]; then
      doctor_record pass "$service is healthy" "$health_status"
    else
      doctor_record fail "$service is unhealthy" "Status: ${health_status:-unknown}. Inspect sudo towbar logs $service."
    fi
    restart_count="$(docker inspect --format '{{.RestartCount}}' "$container_id" 2>/dev/null || true)"
    if [[ "$restart_count" =~ ^[0-9]+$ ]] && ((restart_count >= 3)); then
      doctor_record warn "$service has restarted repeatedly" "$restart_count restarts"
    fi
  done

  if compose_for "$release_dir" "$commit" "$TOWBAR_ENV_FILE" \
    exec -T postgres pg_isready -U towbar -d towbar >/dev/null 2>&1; then
    doctor_record pass "PostgreSQL accepts Towbar connections"
  else
    doctor_record fail "PostgreSQL rejected the readiness check"
  fi

  if (verify_running_release "$release_dir" "$commit") >/dev/null 2>&1; then
    doctor_record pass "Running services match the installed release" "${DOCTOR_VERSION} at ${commit:0:12}"
  else
    doctor_record fail "Running services do not match the installed release" "Run sudo towbar logs, then sudo towbar restart after correcting the failure."
  fi
}

doctor_check_local_access() {
  local release_dir="$1" commit="$2" gateway_service="$3" container_id published
  container_id="$(compose_for "$release_dir" "$commit" "$TOWBAR_ENV_FILE" ps -q "$gateway_service" 2>/dev/null || true)"
  published="$(docker port "$container_id" 4021/tcp 2>/dev/null || true)"
  if [[ "$published" == 127.0.0.1:4021 ]]; then
    doctor_record pass "Dashboard is restricted to this host" "$published"
  else
    doctor_record fail "Local dashboard binding is not isolated" "Expected 127.0.0.1:4021; found ${published:-no published port}."
  fi
  if curl --fail --silent --show-error --max-time 10 http://127.0.0.1:4021/health >/dev/null 2>&1; then
    doctor_record pass "Local dashboard responds"
  else
    doctor_record fail "Local dashboard does not respond" "Check sudo towbar logs gateway web-app."
  fi
  doctor_record pass "External API and MCP access are disabled" "Public automation access requires a Towbar HTTPS installation."
}

doctor_check_public_access() {
  local release_dir="$1" commit="$2" gateway_service="$3"
  local container_id hostname app_url addresses published_http published_https api_status certificate issuer expiry
  container_id="$(compose_for "$release_dir" "$commit" "$TOWBAR_ENV_FILE" ps -q "$gateway_service" 2>/dev/null || true)"
  hostname="$(env_value "$TOWBAR_ENV_FILE" TOWBAR_GATEWAY_DOMAIN)"
  app_url="$(env_value "$TOWBAR_ENV_FILE" TOWBAR_APP_BASE_URL)"
  published_http="$(docker port "$container_id" 80/tcp 2>/dev/null || true)"
  published_https="$(docker port "$container_id" 443/tcp 2>/dev/null || true)"
  if [[ -n "$published_http" && -n "$published_https" ]]; then
    doctor_record pass "HTTPS gateway publishes ports 80 and 443"
  else
    doctor_record fail "HTTPS gateway ports are incomplete" "HTTP: ${published_http:-missing}; HTTPS: ${published_https:-missing}."
  fi

  addresses="$(getent ahostsv4 "$hostname" 2>/dev/null | awk '$2 == "STREAM" { print $1 }' | sort -u | paste -sd, - || true)"
  if [[ -n "$addresses" ]]; then
    doctor_record pass "Public hostname has an A record" "$hostname resolves to $addresses."
  else
    doctor_record fail "Public hostname does not resolve" "Create an A record for $hostname."
  fi

  if curl \
    --fail --silent --show-error --location --connect-timeout 10 --max-time 20 \
    --noproxy '*' --proto '=https' --resolve "$hostname:443:127.0.0.1" \
    --tlsv1.2 "$app_url/health" >/dev/null 2>&1; then
    doctor_record pass "Public HTTPS dashboard responds" "$app_url"
  else
    doctor_record fail "Public HTTPS dashboard verification failed" "Inspect sudo towbar logs $gateway_service."
  fi

  api_status="$(curl \
    --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 10 --max-time 20 --noproxy '*' --proto '=https' \
    --resolve "$hostname:443:127.0.0.1" --tlsv1.2 \
    "$app_url/v1/core/session" 2>/dev/null || true)"
  case "$api_status" in
    200 | 401 | 403)
      doctor_record pass "REST API is routed through the HTTPS origin" "HTTP $api_status from $app_url/v1/core/session"
      ;;
    *)
      doctor_record fail "REST API routing failed" "HTTP ${api_status:-000} from the public origin."
      ;;
  esac

  certificate="$(timeout 15 openssl s_client -connect 127.0.0.1:443 -servername "$hostname" </dev/null 2>/dev/null | openssl x509 -outform PEM 2>/dev/null || true)"
  if [[ -n "$certificate" ]]; then
    issuer="$(openssl x509 -noout -issuer <<<"$certificate" 2>/dev/null | sed 's/^issuer=//' || true)"
    expiry="$(openssl x509 -noout -enddate <<<"$certificate" 2>/dev/null | sed 's/^notAfter=//' || true)"
    if openssl x509 -checkend 604800 -noout <<<"$certificate" >/dev/null 2>&1; then
      doctor_record pass "TLS certificate is valid for more than seven days" "Expires $expiry; issuer $issuer"
    else
      doctor_record fail "TLS certificate expires within seven days" "Expires ${expiry:-unknown}; inspect Caddy renewal logs."
    fi
  else
    doctor_record fail "TLS certificate could not be inspected"
  fi

  if docker exec "$container_id" sh -eu -c \
    'test -n "$(find /data/caddy/certificates -type f -name "$1.crt" -print -quit)"' \
    sh "$hostname" >/dev/null 2>&1; then
    doctor_record pass "Caddy certificate state is persisted"
  else
    doctor_record fail "Caddy certificate state was not found" "A gateway replacement may need to issue a new certificate."
  fi

  if curl --fail --silent --show-error --max-time 10 \
    https://api.github.com/rate_limit >/dev/null 2>&1; then
    doctor_record pass "GitHub is reachable for releases and source access"
  else
    doctor_record warn "GitHub could not be reached" "Upgrades and GitHub-backed workflows may fail."
  fi
  if curl --fail --silent --show-error --max-time 10 \
    https://acme-v02.api.letsencrypt.org/directory >/dev/null 2>&1; then
    doctor_record pass "Let's Encrypt is reachable for certificate renewal"
  else
    doctor_record warn "Let's Encrypt could not be reached" "Automatic certificate renewal may fail."
  fi
}

doctor_command() {
  local release_dir gateway_service warning_label
  require_root doctor
  require_linux
  [[ $# -eq 0 ]] || fail "usage: towbar doctor"

  release_dir="$(current_release_dir)"
  [[ -f "$release_dir/.towbar-release" ]] || fail "the current release is missing Towbar metadata"
  DOCTOR_VERSION="$(metadata_value "$release_dir" VERSION)"
  DOCTOR_COMMIT="$(metadata_value "$release_dir" COMMIT)"
  DOCTOR_MODE="$(env_value "$TOWBAR_ENV_FILE" TOWBAR_INSTALL_MODE 2>/dev/null || true)"
  DOCTOR_MODE="${DOCTOR_MODE:-local}"
  gateway_service="$(gateway_service_for "$TOWBAR_ENV_FILE")"
  DOCTOR_PASS_COUNT=0
  DOCTOR_WARN_COUNT=0
  DOCTOR_FAIL_COUNT=0
  ui_brand
  ui_heading "Checking Towbar"
  ui_note "$DOCTOR_VERSION · $DOCTOR_MODE mode · ${DOCTOR_COMMIT:0:12}"
  printf '\n'

  doctor_check_host
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    doctor_check_disk_usage
  fi
  doctor_check_config "$release_dir"
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    doctor_check_services "$release_dir" "$DOCTOR_COMMIT" "$gateway_service"
    case "$DOCTOR_MODE" in
      local) doctor_check_local_access "$release_dir" "$DOCTOR_COMMIT" "$gateway_service" ;;
      public) doctor_check_public_access "$release_dir" "$DOCTOR_COMMIT" "$gateway_service" ;;
      *) doctor_record fail "Installation mode is invalid" "$DOCTOR_MODE" ;;
    esac
  fi

  printf '\n'
  if ((DOCTOR_FAIL_COUNT > 0)); then
    warning_label=warnings
    ((DOCTOR_WARN_COUNT == 1)) && warning_label=warning
    ui_failure_step "Towbar needs attention: $DOCTOR_FAIL_COUNT failed, $DOCTOR_WARN_COUNT $warning_label, $DOCTOR_PASS_COUNT passed"
  elif ((DOCTOR_WARN_COUNT > 0)); then
    warning_label=warnings
    ((DOCTOR_WARN_COUNT == 1)) && warning_label=warning
    ui_success_heading "Towbar is healthy with $DOCTOR_WARN_COUNT $warning_label"
    ui_note "$DOCTOR_PASS_COUNT checks passed."
  else
    ui_success_heading "Towbar is healthy"
    ui_note "$DOCTOR_PASS_COUNT checks passed."
  fi

  ((DOCTOR_FAIL_COUNT == 0))
}
