#!/usr/bin/env bash
set -Eeuo pipefail

release_tag="${1:-}"
release_commit="${2:-}"
deploy_root="${3:-/opt/towbar}"
repository_url="${4:-}"
runtime_env_secret_id="${5:-}"
aws_region="${6:-}"
deploy_owner="${7:-towbar}"

fail() {
  echo "Towbar bootstrap failed: $*" >&2
  exit 1
}

if ((EUID != 0)); then
  fail "bootstrap must run as root through AWS Systems Manager"
fi
if [[ ! "$release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  fail "release tag must be a stable semantic version"
fi
if [[ ! "$release_commit" =~ ^[0-9a-f]{40}$ ]]; then
  fail "release commit must be a full Git commit SHA"
fi
if [[ "$deploy_root" != /* || "$deploy_root" == / ]]; then
  fail "deployment root must be a specific absolute path"
fi
if [[ ! "$repository_url" =~ ^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git$ ]]; then
  fail "repository URL must be a public GitHub HTTPS clone URL"
fi
[[ -n "$runtime_env_secret_id" ]] || fail "runtime environment secret ID is required"
[[ -n "$aws_region" ]] || fail "AWS region is required"
if [[ ! "$deploy_owner" =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  fail "deployment owner is invalid"
fi

install_apt_prerequisites() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install --yes ca-certificates curl git openssl util-linux awscli

  if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
    # Supplied by every supported distribution.
    # shellcheck disable=SC1091
    . /etc/os-release
    case "${ID:-}" in
      ubuntu | debian) ;;
      *) fail "automatic Docker installation supports Ubuntu and Debian" ;;
    esac

    install -m 0755 -d /etc/apt/keyrings
    curl --fail --silent --show-error --location \
      "https://download.docker.com/linux/$ID/gpg" \
      --output /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    printf \
      'deb [arch=%s signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/%s %s stable\n' \
      "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" \
      >/etc/apt/sources.list.d/docker.list
    apt-get update
    apt-get install --yes \
      containerd.io docker-buildx-plugin docker-ce docker-ce-cli \
      docker-compose-plugin
  fi
}

if command -v apt-get >/dev/null; then
  install_apt_prerequisites
else
  fail "automatic bootstrap currently supports Ubuntu and Debian hosts"
fi

for command_name in aws curl docker git runuser stat; do
  command -v "$command_name" >/dev/null ||
    fail "missing required command after bootstrap: $command_name"
done
docker compose version >/dev/null 2>&1 || fail "Docker Compose v2 is unavailable"
systemctl enable --now docker

if ! id "$deploy_owner" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --system "$deploy_owner"
fi

if [[ ! -e "$deploy_root" ]]; then
  install -d -m 0755 -o "$deploy_owner" -g "$deploy_owner" "$deploy_root"
fi
[[ -d "$deploy_root" ]] || fail "$deploy_root is not a directory"
bootstrap_marker="$deploy_root/.towbar-bootstrap-complete"
[[ ! -e "$bootstrap_marker" ]] ||
  fail "this host is already bootstrapped; use the Deploy release workflow"

if [[ ! -d "$deploy_root/.git" ]]; then
  if [[ -n "$(find "$deploy_root" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then
    fail "$deploy_root is not empty and is not a Git checkout"
  fi
  runuser --user "$deploy_owner" -- \
    git clone --no-checkout "$repository_url" "$deploy_root"
fi

repo_owner="$(stat -c '%U' "$deploy_root")"
repo_group="$(stat -c '%G' "$deploy_root")"
[[ "$repo_owner" == "$deploy_owner" ]] ||
  fail "$deploy_root is owned by $repo_owner instead of $deploy_owner"

configured_repository_url="$(
  runuser --user "$deploy_owner" -- \
    git -c "safe.directory=$deploy_root" -C "$deploy_root" \
    remote get-url origin
)"
[[ "$configured_repository_url" == "$repository_url" ]] ||
  fail "$deploy_root origin is $configured_repository_url instead of $repository_url"

runuser --user "$deploy_owner" -- \
  git -c "safe.directory=$deploy_root" -C "$deploy_root" fetch --force --tags origin \
  "refs/tags/$release_tag:refs/tags/$release_tag"
resolved_commit="$(
  runuser --user "$deploy_owner" -- \
    git -c "safe.directory=$deploy_root" -C "$deploy_root" \
    rev-parse "$release_tag^{commit}"
)"
[[ "$resolved_commit" == "$release_commit" ]] ||
  fail "$release_tag resolves to $resolved_commit instead of $release_commit"

runuser --user "$deploy_owner" -- \
  git -c "safe.directory=$deploy_root" -C "$deploy_root" \
  checkout --detach --force "$release_commit"

pending_env="$(mktemp "$deploy_root/.env.pending.XXXXXX")"
cleanup_pending_env() {
  rm -f "$pending_env"
}
trap cleanup_pending_env EXIT
aws secretsmanager get-secret-value \
  --region "$aws_region" \
  --secret-id "$runtime_env_secret_id" \
  --query SecretString \
  --output text >"$pending_env"
[[ -s "$pending_env" ]] || fail "runtime environment secret is empty"
chown "$repo_owner:$repo_group" "$pending_env"
chmod 600 "$pending_env"
mv -f "$pending_env" "$deploy_root/.env"
trap - EXIT
echo "Installed the managed runtime environment at $deploy_root/.env"

bash "$deploy_root/infra/deploy-release.sh" \
  "$release_tag" \
  "$release_commit" \
  "$deploy_root"

install \
  -o "$repo_owner" \
  -g "$repo_group" \
  -m 600 \
  /dev/null \
  "$bootstrap_marker"
