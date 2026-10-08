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
    INSTALL_API_BASE_URL=http://localhost:4020
    INSTALL_HOSTNAME=
    INSTALL_API_HOSTNAME=
    return
  fi

  if [[ "$lowercase_url" =~ ^https?://localhost([:/?#]|$) ]]; then
    fail "localhost is supported only as http://localhost:4021"
  fi

  validate_https_url "$lowercase_url" "Towbar URL"
  INSTALL_MODE=public
  INSTALL_APP_URL="$lowercase_url"
  INSTALL_HOSTNAME="${lowercase_url#https://}"
}

set_install_api_url() {
  local requested_url="${1%/}" lowercase_url
  lowercase_url="$(printf '%s' "$requested_url" | tr '[:upper:]' '[:lower:]')"
  validate_https_url "$lowercase_url" "Towbar API URL"
  [[ "$lowercase_url" != "$INSTALL_APP_URL" ]] ||
    fail "Towbar API URL must use a different hostname from the dashboard"
  INSTALL_API_BASE_URL="$lowercase_url"
  INSTALL_API_HOSTNAME="${lowercase_url#https://}"
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
    printf 'Dashboard: %s\nAPI and MCP: %s\n' "$INSTALL_APP_URL" "$INSTALL_API_BASE_URL"
    ui_note "Towbar will verify DNS and configure HTTPS for both names."
  else
    printf 'Towbar will stay available only on this server.\n'
    ui_note "Dashboard: $INSTALL_APP_URL; API: $INSTALL_API_BASE_URL."
  fi
  printf '\n'
}

collect_install_settings() {
  local requested_url="${TOWBAR_INSTALL_URL:-http://localhost:4021}" requested_api_url

  if interactive_terminal; then
    ui_heading "Where will Towbar be available?"
    ui_note "Keep it private, or enter a public HTTPS domain with an A record pointing here."
    printf '\n'
    requested_url="$(prompt_install_url "$requested_url")"
  fi

  set_install_url "$requested_url"
  if [[ "$INSTALL_MODE" == public ]]; then
    requested_api_url="${TOWBAR_INSTALL_API_URL:-https://${INSTALL_HOSTNAME%%.*}-api.${INSTALL_HOSTNAME#*.}}"
    if interactive_terminal; then
      ui_heading "Where will the Towbar API and MCP be available?"
      requested_api_url="$(prompt_install_url "$requested_api_url")"
    fi
    set_install_api_url "$requested_api_url"
  fi
  show_install_summary
  if interactive_terminal && ! prompt_confirm "Continue with this installation?"; then
    fail "installation cancelled"
  fi
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
  verify_public_dns "$INSTALL_API_HOSTNAME"
  verify_public_ports
}
