prompt_install_url() {
  local default_url="$1" answer
  if gum_available; then
    answer="$(
      gum input \
        --cursor.foreground 214 \
        --prompt.foreground 214 \
        --prompt "› " \
        --header "Specify URL (Enter to continue with $default_url):" \
        --header.foreground 250 \
        --placeholder "$default_url"
    )"
  else
    printf '%sSpecify URL%s %s(Enter to continue with %s):%s ' \
      "$STYLE_BOLD" "$STYLE_RESET" "$STYLE_MUTED" "$default_url" \
      "$STYLE_RESET" >&2
    read -r answer
  fi
  printf '%s\n' "${answer:-$default_url}"
}

prompt_confirm() {
  local prompt="$1" answer
  if gum_available; then
    gum confirm \
      --affirmative "Install" \
      --negative "Cancel" \
      --prompt.foreground 214 \
      "$prompt"
    return
  fi

  printf '%s%s [Y/n]: %s' "$STYLE_BOLD" "$prompt" "$STYLE_RESET" >&2
  read -r answer
  [[ "$answer" =~ ^[Nn]$ ]] && return 1
  [[ -z "$answer" || "$answer" =~ ^[Yy]$ ]]
}

validate_https_url() {
  local url="${1%/}" hostname label
  local -a hostname_labels
  [[ "$url" =~ ^https://[^/?#@[:space:]]+$ ]] ||
    fail "$2 must be an HTTPS origin without a path or port"
  hostname="${url#https://}"
  [[ ${#hostname} -le 253 && "$hostname" == *.* ]] ||
    fail "$2 must use a valid public hostname"
  IFS=. read -r -a hostname_labels <<<"$hostname"
  for label in "${hostname_labels[@]}"; do
    [[ ${#label} -ge 1 && ${#label} -le 63 ]] ||
      fail "$2 contains an invalid hostname label"
    [[ "$label" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] ||
      fail "$2 contains an invalid hostname label"
  done
}

set_install_url() {
  local requested_url="${1%/}" lowercase_url
  lowercase_url="$(printf '%s' "$requested_url" | tr '[:upper:]' '[:lower:]')"

  if [[ "$lowercase_url" == "http://localhost:4021" ]]; then
    INSTALL_MODE=local
    INSTALL_APP_URL=http://localhost:4021
    INSTALL_HOSTNAME=
    INSTALL_PROXY_HOPS=1
    return
  fi

  if [[ "$lowercase_url" =~ ^https?://localhost([:/?#]|$) ]]; then
    fail "localhost is supported only as http://localhost:4021"
  fi

  validate_https_url "$lowercase_url" "Towbar URL"
  INSTALL_MODE=public
  INSTALL_APP_URL="$lowercase_url"
  INSTALL_HOSTNAME="${lowercase_url#https://}"
  INSTALL_PROXY_HOPS=1
}

set_env_value() {
  local env_file="$1" key="$2" value="$3" pending
  pending="$(mktemp "${env_file}.XXXXXX")"
  awk \
    -v key="$key" \
    -v value="$value" \
    'BEGIN { FS = OFS = "="; found = 0 }
      $1 == key { print key, value; found = 1; next }
      { print }
      END { if (!found) print key, value }' \
    "$env_file" >"$pending"
  chmod 600 "$pending"
  mv "$pending" "$env_file"
}

env_value() {
  local env_file="$1" key="$2"
  awk -F= -v key="$key" '$1 == key { print substr($0, length(key) + 2); exit }' \
    "$env_file"
}

show_install_summary() {
  printf '\n'
  ui_success_heading "Ready to install Towbar"
  if [[ "$INSTALL_MODE" == public ]]; then
    printf 'Towbar will be available at %s.\n' "$INSTALL_APP_URL"
    ui_note "Towbar will verify DNS and configure HTTPS automatically."
  else
    printf 'Towbar will stay available only on this server.\n'
    ui_note "Open the dashboard at $INSTALL_APP_URL after installation."
  fi
  printf '\n'
}

collect_install_settings() {
  local requested_url="${TOWBAR_INSTALL_URL:-http://localhost:4021}"

  if interactive_terminal; then
    ui_heading "Where will Towbar be available?"
    ui_note "Keep it private, or enter a public HTTPS domain with an A record pointing here."
    printf '\n'
    requested_url="$(prompt_install_url "$requested_url")"
  fi

  set_install_url "$requested_url"
  show_install_summary
  if interactive_terminal && ! prompt_confirm "Continue with this installation?"; then
    fail "installation cancelled"
  fi
}

apply_install_settings() {
  set_env_value "$TOWBAR_ENV_FILE" COMPOSE_PROFILES "$INSTALL_MODE"
  set_env_value "$TOWBAR_ENV_FILE" TOWBAR_INSTALL_MODE "$INSTALL_MODE"
  set_env_value "$TOWBAR_ENV_FILE" TOWBAR_BIND_ADDRESS 127.0.0.1
  set_env_value "$TOWBAR_ENV_FILE" TOWBAR_GATEWAY_DOMAIN "$INSTALL_HOSTNAME"
  set_env_value "$TOWBAR_ENV_FILE" TOWBAR_APP_BASE_URL "$INSTALL_APP_URL"
  set_env_value \
    "$TOWBAR_ENV_FILE" TOWBAR_GITLAB_OAUTH_REDIRECT_URI \
    "$INSTALL_APP_URL/v1/core/gitlab/oauth/callback"
  set_env_value \
    "$TOWBAR_ENV_FILE" TOWBAR_TRUSTED_PROXY_HOPS "$INSTALL_PROXY_HOPS"
}

verify_public_dns() {
  local hostname="$1" addresses
  addresses="$(
    getent ahostsv4 "$hostname" 2>/dev/null |
      awk '$2 == "STREAM" { print $1 }' |
      sort -u
  )"
  [[ -n "$addresses" ]] ||
    fail "$hostname does not have a resolvable A record; point it to this server and try again"
  ui_step "$hostname resolves to $(tr '\n' ' ' <<<"$addresses" | xargs)"
}

verify_public_ports() {
  local port
  for port in 80 443; do
    if ss -H -ltn "sport = :$port" | grep -q .; then
      fail "port $port is already in use; Towbar needs ports 80 and 443 for automatic HTTPS"
    fi
  done
  ui_step "Ports 80 and 443 are available for HTTPS"
}

verify_public_prerequisites() {
  [[ "$INSTALL_MODE" == public ]] || return 0
  ui_pending_step "Checking the domain and HTTPS ports"
  verify_public_dns "$INSTALL_HOSTNAME"
  verify_public_ports
}

preview_installation() {
  local delay="${TOWBAR_PREVIEW_DELAY:-0.12}" step
  local -a steps=(
    "Inspecting the host"
    "Installing Docker and prerequisites"
    "Verifying the $CLI_RELEASE release"
    "Generating installation secrets"
    "Downloading the control-plane images"
    "Applying the database schema"
    "Starting Towbar"
    "Verifying the API, worker and dashboard"
  )
  if [[ "$INSTALL_MODE" == public ]]; then
    steps=(
      "Inspecting the host"
      "Installing Docker and prerequisites"
      "Checking DNS and HTTPS ports"
      "Verifying the $CLI_RELEASE release"
      "Generating installation secrets"
      "Downloading the control-plane images"
      "Applying the database schema"
      "Starting Towbar"
      "Issuing the Let's Encrypt certificate"
      "Verifying HTTPS and certificate renewal"
      "Verifying the API, worker and dashboard"
    )
  fi

  printf '\n'
  ui_heading "Installing Towbar"
  for step in "${steps[@]}"; do
    if [[ -t 1 && -n "$STYLE_YELLOW" ]]; then
      ui_pending_step "$step"
      sleep "$delay"
      printf '\033[1A\033[2K'
    fi
    ui_step "$step"
  done

  printf '\n%s%sTowbar is ready%s\n' \
    "$STYLE_BOLD" "$STYLE_GREEN" "$STYLE_RESET"
  printf 'Open the dashboard at %s\n' "$INSTALL_APP_URL"
  printf '\n'
  ui_note "The dashboard URL is printed here after a real installation."
  ui_note "The browser setup asks for your team name, name, email and password."
}

preview_command() {
  [[ $# -le 1 ]] || fail "usage: towbar preview [--defaults]"
  case "${1:-}" in
    "") ;;
    --defaults) TOWBAR_NON_INTERACTIVE=1 ;;
    *) fail "usage: towbar preview [--defaults]" ;;
  esac
  ui_brand
  collect_install_settings
  preview_installation
}
