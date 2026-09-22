require_root() {
  ((EUID == 0)) || fail "this command must run as root; use sudo towbar $*"
}

require_linux() {
  [[ "$(uname -s)" == Linux ]] || fail "Towbar installation supports Linux hosts"
}

validate_repository() {
  [[ "$TOWBAR_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] ||
    fail "TOWBAR_REPOSITORY must be a GitHub owner/repository pair"
}

validate_version() {
  [[ "$1" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] ||
    fail "release must be a stable semantic version such as v2.0.0"
  [[ "${BASH_REMATCH[1]}" == "${CLI_VERSION%%.*}" ]] ||
    fail "Towbar CLI $CLI_VERSION supports only v${CLI_VERSION%%.*} releases"
}

acquire_lock() {
  install -d -m 0755 "$(dirname "$LOCK_FILE")"
  exec 9>"$LOCK_FILE"
  flock --nonblock 9 || fail "another Towbar operation is running"
}

require_runtime_tools() {
  local command_name
  for command_name in curl docker git jq openssl tar; do
    command -v "$command_name" >/dev/null ||
      fail "missing required command: $command_name"
  done
  docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is required"
}

install_prerequisites() {
  require_linux
  command -v apt-get >/dev/null ||
    fail "automatic installation currently supports Ubuntu and Debian"

  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install --yes ca-certificates curl git iproute2 jq openssl tar util-linux

  if command -v docker >/dev/null; then
    docker compose version >/dev/null 2>&1 ||
      fail "Docker is installed without Compose v2; install the Docker Compose plugin"
    systemctl enable --now docker
    return
  fi

  # Supplied by every supported distribution.
  # shellcheck disable=SC1091
  . /etc/os-release
  case "${ID:-}" in
    ubuntu | debian) ;;
    *) fail "automatic Docker installation supports Ubuntu and Debian" ;;
  esac

  apt-get remove --yes \
    containerd docker-compose docker-compose-v2 docker-doc docker.io \
    podman-docker runc >/dev/null 2>&1 || true
  install -m 0755 -d /etc/apt/keyrings
  curl \
    --fail \
    --silent \
    --show-error \
    --location \
    --proto '=https' \
    --tlsv1.2 \
    "https://download.docker.com/linux/$ID/gpg" \
    --output /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc

  distro_codename="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  [[ -n "$distro_codename" ]] || fail "could not determine the distribution codename"
  cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: $distro_codename
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

  apt-get update
  apt-get install --yes \
    containerd.io docker-buildx-plugin docker-ce docker-ce-cli \
    docker-compose-plugin
  systemctl enable --now docker
}
