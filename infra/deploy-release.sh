#!/usr/bin/env bash
set -Eeuo pipefail

release_tag="${1:-}"
release_commit="${2:-}"
deploy_root="${3:-/opt/towbar}"

fail() {
  echo "Towbar release deployment failed: $*" >&2
  exit 1
}

if [[ ! "$release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  fail "release tag must be a stable semantic version"
fi
if [[ ! "$release_commit" =~ ^[0-9a-f]{40}$ ]]; then
  fail "release commit must be a full Git commit SHA"
fi
if [[ "$deploy_root" != /* || "$deploy_root" == / ]]; then
  fail "deployment root must be a specific absolute path"
fi
if ((EUID != 0)); then
  fail "deployment must run as root through the host's SSM agent"
fi

for command_name in curl docker git runuser stat; do
  command -v "$command_name" >/dev/null ||
    fail "missing required command: $command_name"
done

[[ -d "$deploy_root/.git" ]] || fail "$deploy_root is not a Git checkout"
[[ -f "$deploy_root/docker-compose.yml" ]] ||
  fail "$deploy_root/docker-compose.yml is missing"
[[ -f "$deploy_root/.env" ]] || fail "$deploy_root/.env is missing"

env_mode="$(stat -c '%a' "$deploy_root/.env")"
if [[ "$env_mode" != 400 && "$env_mode" != 600 ]]; then
  fail "$deploy_root/.env must be readable only by its owner"
fi

repo_owner="$(stat -c '%U' "$deploy_root")"
id "$repo_owner" >/dev/null 2>&1 || fail "repository owner does not exist"

git_as_owner() {
  runuser --user "$repo_owner" -- \
    git -c "safe.directory=$deploy_root" -C "$deploy_root" "$@"
}

compose_for() {
  local image_tag="$1"
  local source_commit="$2"
  shift 2
  TOWBAR_IMAGE_TAG="$image_tag" \
    SOURCE_COMMIT="$source_commit" \
    docker compose \
      --env-file "$deploy_root/.env" \
      --project-directory "$deploy_root" \
      --file "$deploy_root/docker-compose.yml" \
      "$@"
}

if [[ -n "$(git_as_owner status --porcelain --untracked-files=no)" ]]; then
  fail "tracked files in $deploy_root have local changes"
fi

git_as_owner fetch --force --tags origin \
  "refs/tags/$release_tag:refs/tags/$release_tag"

resolved_commit="$(git_as_owner rev-parse "$release_tag^{commit}")"
if [[ "$resolved_commit" != "$release_commit" ]]; then
  fail "$release_tag resolves to $resolved_commit instead of $release_commit"
fi

previous_commit="$(git_as_owner rev-parse HEAD)"
containers_changed=false

rollback() {
  local exit_code="${1:-1}"
  trap - ERR INT TERM
  set +e

  echo "Release deployment failed; restoring checkout $previous_commit" >&2
  git_as_owner checkout --detach --force "$previous_commit"
  if [[ "$containers_changed" == true && "$previous_commit" != "$release_commit" ]]; then
    echo "Restoring the previous Towbar Compose images" >&2
    compose_for "$previous_commit" "$previous_commit" \
      up --detach --wait --remove-orphans
  fi
  exit "$exit_code"
}
deployment_fail() {
  echo "Towbar release deployment failed: $*" >&2
  rollback 1
}
trap 'rollback $?' ERR
trap 'rollback 130' INT
trap 'rollback 143' TERM

git_as_owner checkout --detach --force "$release_commit"

echo "Building Towbar $release_tag ($release_commit)"
compose_for "$release_commit" "$release_commit" \
  build --quiet api worker web-app

containers_changed=true
echo "Applying migrations and replacing Towbar services"
compose_for "$release_commit" "$release_commit" \
  up --detach --wait --remove-orphans

for service in api worker web-app; do
  container_id="$(compose_for "$release_commit" "$release_commit" ps -q "$service")"
  [[ -n "$container_id" ]] || deployment_fail "$service container was not created"

  health_status="$(
    docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' \
      "$container_id"
  )"
  [[ "$health_status" == healthy ]] ||
    deployment_fail "$service finished with status $health_status"

  case "$service" in
    api) expected_image="towbar/api:$release_commit" ;;
    worker) expected_image="towbar/worker:$release_commit" ;;
    web-app) expected_image="towbar/web-app:$release_commit" ;;
  esac
  running_image="$(docker inspect --format '{{.Config.Image}}' "$container_id")"
  [[ "$running_image" == "$expected_image" ]] ||
    deployment_fail "$service runs $running_image instead of $expected_image"
done

api_container_id="$(
  compose_for "$release_commit" "$release_commit" ps -q api
)"
api_version="$(
  docker exec "$api_container_id" node -e \
    'fetch("http://127.0.0.1:4020/health").then((response) => response.json()).then((body) => process.stdout.write(body.version ?? ""))'
)"
[[ "$api_version" == "$release_commit" ]] ||
  deployment_fail "API reports $api_version instead of $release_commit"

trap - ERR INT TERM
echo "Towbar $release_tag is healthy at $release_commit"
