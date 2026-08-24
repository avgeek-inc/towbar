export const prepareRemoteScript = String.raw`
set -euo pipefail
remote_dir="$1"
install -d -m 700 \
  "$remote_dir" \
  "$remote_dir/secrets/build" \
  "$remote_dir/secrets/hooks/postDeploy" \
  "$remote_dir/secrets/hooks/preDeploy" \
  "$remote_dir/secrets/runtime"
`;

export const buildRemoteScript = String.raw`
set -euo pipefail
remote_dir="$1"
image_tag="$2"
dockerfile="$3"
max_expanded_bytes="$4"
max_archive_entries="$5"
rm -rf "$remote_dir/context"
install -d -m 700 "$remote_dir/context"
expanded_bytes="$(gzip -cd "$remote_dir/context.tar.gz" | wc -c)"
test "$expanded_bytes" -le "$max_expanded_bytes"
archive_entries="$(tar -tzf "$remote_dir/context.tar.gz" | wc -l)"
test "$archive_entries" -le "$max_archive_entries"
tar -xzf "$remote_dir/context.tar.gz" \
  --no-same-owner --no-same-permissions -C "$remote_dir/context"
build_args=()
for secret_path in "$remote_dir"/secrets/build/*; do
  test -e "$secret_path" || continue
  secret_id="$(basename "$secret_path")"
  build_args+=(--secret "id=$secret_id,src=$secret_path")
done
DOCKER_BUILDKIT=1 docker build "${"$"}{build_args[@]}" \
  --label "towbar.managed=true" \
  --label "towbar.app=$TOWBAR_APP_ID" \
  --label "towbar.deployable=$TOWBAR_DEPLOYABLE_ID" \
  --label "towbar.source=$TOWBAR_SOURCE_ID" \
  --label "towbar.commit=$TOWBAR_COMMIT_SHA" \
  -f "$remote_dir/context/$dockerfile" \
  -t "$image_tag" \
  "$remote_dir/context"
`;

export const startRemoteScript = String.raw`
set -euo pipefail
remote_dir="$1"
container_name="$2"
image_tag="$3"
container_port="$4"
network_name="$5"
resource_cpus="$6"
resource_memory="$7"
docker rm -f "$container_name" >/dev/null 2>&1 || true
runtime_args=()
if test -n "$network_name"; then runtime_args+=(--network "$network_name"); fi
if test -n "$resource_cpus"; then runtime_args+=(--cpus "$resource_cpus"); fi
if test -n "$resource_memory"; then runtime_args+=(--memory "$resource_memory"); fi
/usr/bin/python3 - "$remote_dir/secrets/runtime" \
  /usr/bin/docker run -d "${"$"}{runtime_args[@]}" \
  --name "$container_name" \
  --restart unless-stopped \
  --add-host host.docker.internal:host-gateway \
  --env "SOURCE_COMMIT=$TOWBAR_COMMIT_SHA" \
  --env "TOWBAR_APP_ID=$TOWBAR_APP_ID" \
  --env "TOWBAR_COMMIT_SHA=$TOWBAR_COMMIT_SHA" \
  --env "TOWBAR_DEPLOYMENT_ID=$TOWBAR_DEPLOYMENT_ID" \
  --label "towbar.managed=true" \
  --label "towbar.app=$TOWBAR_APP_ID" \
  --label "towbar.deployable=$TOWBAR_DEPLOYABLE_ID" \
  --label "towbar.source=$TOWBAR_SOURCE_ID" \
  --label "towbar.deployment=$TOWBAR_DEPLOYMENT_ID" \
  -p "127.0.0.1::$container_port" \
  "$image_tag" <<'PYTHON' >/dev/null
import os
from pathlib import Path
import sys

runtime_directory = Path(sys.argv[1])
command = sys.argv[2:]
runtime_arguments: list[str] = []
for secret_path in sorted(runtime_directory.iterdir()):
    if not secret_path.is_file():
        continue
    os.environ[secret_path.name] = secret_path.read_text(encoding="utf-8")
    runtime_arguments.extend(("--env", secret_path.name))
command[3:3] = runtime_arguments
os.execve(command[0], command, os.environ)
PYTHON
docker port "$container_name" "$container_port/tcp" | awk -F: 'NR==1 {print $NF}'
`;

export const startResourceRemoteScript = String.raw`
set -euo pipefail
remote_dir="$1"
container_name="$2"
image_tag="$3"
container_port="$4"
network_name="$5"
network_alias="$6"
host_port="$7"
resource_cpus="$8"
resource_memory="$9"
previous_container="${"$"}{10}"
deployable_id="${"$"}{11}"
volume_count="${"$"}{12}"
shift 12
docker rm -f "$container_name" >/dev/null 2>&1 || true
python3 - "$network_name" "$network_alias" "$host_port" "$previous_container" <<'PYTHON'
import json
import re
import socket
import subprocess
import sys

network_name, network_alias, host_port, previous_container = sys.argv[1:]

if host_port:
    version = subprocess.run(
        ["docker", "version", "--format", "{{.Server.Version}}"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    major = re.match(r"^(\d+)", version)
    if not major or int(major.group(1)) < 28:
        raise SystemExit(
            "SSH tunnel access requires Docker Engine 28 or newer for safe loopback publishing"
        )

def inspect_container(container_id):
    result = subprocess.run(
        ["docker", "container", "inspect", container_id],
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None
    values = json.loads(result.stdout)
    return values[0] if values else None

running = subprocess.run(
    ["docker", "ps", "-q"],
    check=True,
    capture_output=True,
    text=True,
).stdout.splitlines()
port_held_by_previous = False
for container_id in running:
    container = inspect_container(container_id)
    if not container:
        continue
    name = container.get("Name", "").lstrip("/")
    if network_name and network_alias:
        network = (container.get("NetworkSettings", {}).get("Networks") or {}).get(
            network_name
        )
        aliases = (network or {}).get("Aliases") or []
        if network_alias in aliases and name != previous_container:
            raise SystemExit(
                f"Docker network alias '{network_alias}' is already used by container '{name}'"
            )
    if host_port:
        bindings = container.get("NetworkSettings", {}).get("Ports") or {}
        for values in bindings.values():
            for binding in values or []:
                if binding.get("HostPort") != host_port:
                    continue
                if name != previous_container:
                    raise SystemExit(
                        f"Loopback host port '{host_port}' is already used by container '{name}'"
                    )
                port_held_by_previous = True

if host_port and not port_held_by_previous:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        probe.bind(("127.0.0.1", int(host_port)))
    except OSError as error:
        raise SystemExit(
            f"Loopback host port '{host_port}' is unavailable: {error}"
        ) from error
    finally:
        probe.close()
PYTHON
runtime_args=()
if test -n "$network_name"; then
  runtime_args+=(--network "$network_name")
  if test -n "$network_alias"; then runtime_args+=(--network-alias "$network_alias"); fi
fi
if test -n "$resource_cpus"; then runtime_args+=(--cpus "$resource_cpus"); fi
if test -n "$resource_memory"; then runtime_args+=(--memory "$resource_memory"); fi
for ((index = 0; index < volume_count; index += 1)); do
  logical_name="$1"
  mount_path="$2"
  shift 2
  volume_name="towbar-$deployable_id-$logical_name"
  docker volume create \
    --label "towbar.managed=true" \
    --label "towbar.deployable=$deployable_id" \
    --label "towbar.source=$TOWBAR_SOURCE_ID" \
    "$volume_name" >/dev/null
  runtime_args+=(--mount "type=volume,src=$volume_name,dst=$mount_path")
done
if test -n "$previous_container" && docker container inspect "$previous_container" >/dev/null 2>&1; then
  docker stop --time 30 "$previous_container" >/dev/null
fi
docker_command=(
  /usr/bin/docker run -d "${"$"}{runtime_args[@]}"
  --name "$container_name"
  --restart unless-stopped
  --add-host host.docker.internal:host-gateway
  --env "SOURCE_COMMIT=$TOWBAR_COMMIT_SHA"
  --env "TOWBAR_APP_ID=$TOWBAR_APP_ID"
  --env "TOWBAR_COMMIT_SHA=$TOWBAR_COMMIT_SHA"
  --env "TOWBAR_DEPLOYMENT_ID=$TOWBAR_DEPLOYMENT_ID"
  --label "towbar.managed=true"
  --label "towbar.app=$TOWBAR_CLEANUP_ID"
  --label "towbar.resource=$deployable_id"
  --label "towbar.deployable=$TOWBAR_DEPLOYABLE_ID"
  --label "towbar.source=$TOWBAR_SOURCE_ID"
  --label "towbar.deployment=$TOWBAR_DEPLOYMENT_ID"
)
if test -n "$container_port"; then
  if test -n "$host_port"; then
    docker_command+=(-p "127.0.0.1:$host_port:$container_port")
  else
    docker_command+=(-p "127.0.0.1::$container_port")
  fi
fi
docker_command+=("$image_tag")
if (( $# > 0 )); then docker_command+=("$@"); fi
/usr/bin/python3 - "$remote_dir/secrets/runtime" "${"$"}{docker_command[@]}" <<'PYTHON' >/dev/null
import os
from pathlib import Path
import sys

runtime_directory = Path(sys.argv[1])
command = sys.argv[2:]
runtime_arguments: list[str] = []
for secret_path in sorted(runtime_directory.iterdir()):
    if not secret_path.is_file():
        continue
    os.environ[secret_path.name] = secret_path.read_text(encoding="utf-8")
    runtime_arguments.extend(("--env", secret_path.name))
command[3:3] = runtime_arguments
os.execve(command[0], command, os.environ)
PYTHON
if test -n "$container_port"; then
  docker port "$container_name" "$container_port/tcp" | awk -F: 'NR==1 {print $NF}'
else
  printf '0\n'
fi
`;

export const hookRemoteScript = String.raw`
set -euo pipefail
remote_dir="$1"
hook_name="$2"
container_name="$3"
image_tag="$4"
network_name="$5"
resource_cpus="$6"
resource_memory="$7"
timeout_seconds="$8"
shift 8
(( $# > 0 ))
hook_container="$container_name-hook-${"$"}{hook_name,,}"
secret_directory="$remote_dir/secrets/hooks/$hook_name"
runtime_args=()
if test -n "$network_name"; then runtime_args+=(--network "$network_name"); fi
if test -n "$resource_cpus"; then runtime_args+=(--cpus "$resource_cpus"); fi
if test -n "$resource_memory"; then runtime_args+=(--memory "$resource_memory"); fi
cleanup_hook() { docker rm -f "$hook_container" >/dev/null 2>&1 || true; }
trap cleanup_hook EXIT
/usr/bin/timeout --signal=TERM --kill-after=10s "$timeout_seconds" \
  /usr/bin/python3 - "$secret_directory" \
  /usr/bin/docker run --rm "${"$"}{runtime_args[@]}" \
  --name "$hook_container" \
  --add-host host.docker.internal:host-gateway \
  --env "SOURCE_COMMIT=$TOWBAR_COMMIT_SHA" \
  --env "TOWBAR_APP_ID=$TOWBAR_APP_ID" \
  --env "TOWBAR_COMMIT_SHA=$TOWBAR_COMMIT_SHA" \
  --env "TOWBAR_DEPLOYMENT_ID=$TOWBAR_DEPLOYMENT_ID" \
  --env "TOWBAR_HOOK=$hook_name" \
  "$image_tag" "$@" <<'PYTHON'
import os
from pathlib import Path
import sys

secret_directory = Path(sys.argv[1])
command = sys.argv[2:]
runtime_arguments: list[str] = []
for secret_path in sorted(secret_directory.iterdir()):
    if not secret_path.is_file():
        continue
    os.environ[secret_path.name] = secret_path.read_text(encoding="utf-8")
    runtime_arguments.extend(("--env", secret_path.name))
command[3:3] = runtime_arguments
os.execve(command[0], command, os.environ)
PYTHON
`;

export const healthRemoteScript = String.raw`
set -euo pipefail
port="$1"
health_path="$2"
timeout_seconds="$3"
deadline=$((SECONDS + timeout_seconds))
until curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$port$health_path" >/dev/null; do
  if (( SECONDS >= deadline )); then exit 1; fi
  sleep 2
done
`;

export const containerHealthRemoteScript = String.raw`
set -euo pipefail
container_name="$1"
health_type="$2"
timeout_seconds="$3"
shift 3
deadline=$((SECONDS + timeout_seconds))
while true; do
  healthy=false
  if test "$health_type" = container; then
    state="$(docker inspect --format '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_name" 2>/dev/null || true)"
    if test "$state" = 'true none' || test "$state" = 'true healthy'; then healthy=true; fi
  elif docker exec "$container_name" "$@" >/dev/null 2>&1; then
    healthy=true
  fi
  if test "$healthy" = true; then exit 0; fi
  if (( SECONDS >= deadline )); then exit 1; fi
  sleep 2
done
`;

export const ensureNetworkRemoteScript = String.raw`
set -euo pipefail
network_name="$1"
if docker network inspect "$network_name" >/dev/null 2>&1; then
  exit 0
fi
if docker network create \
  --driver bridge \
  --label towbar.managed=true \
  "$network_name" >/dev/null 2>&1; then
  exit 0
fi
# A concurrent deployment may have created the shared network after the first
# inspection. Accept that race only when the requested network now exists.
docker network inspect "$network_name" >/dev/null
`;

export const configureCaddyScript = String.raw`
set -euo pipefail
remote_dir="$1"
app_id="$2"
sudo install -d -m 755 /etc/caddy/towbar
if ! test -f "$remote_dir/caddy.previous.state"; then
  if sudo test -f "/etc/caddy/towbar/$app_id.caddy"; then
    sudo cp "/etc/caddy/towbar/$app_id.caddy" "$remote_dir/caddy.previous"
    printf 'present' >"$remote_dir/caddy.previous.state"
  else
    printf 'absent' >"$remote_dir/caddy.previous.state"
  fi
fi
if ! test -f "$remote_dir/cloudflare.previous.state"; then
  if sudo test -f /etc/caddy/towbar/cloudflare.env; then
    sudo cp /etc/caddy/towbar/cloudflare.env "$remote_dir/cloudflare.previous"
    printf 'present' >"$remote_dir/cloudflare.previous.state"
  else
    printf 'absent' >"$remote_dir/cloudflare.previous.state"
  fi
fi
sudo install -m 644 "$remote_dir/app.caddy" "/etc/caddy/towbar/$app_id.caddy"
if ! sudo grep -Fq 'import /etc/caddy/towbar/*.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/towbar/*.caddy\n' | sudo tee -a /etc/caddy/Caddyfile >/dev/null
fi
if test -s "$remote_dir/cloudflare.env"; then
  sudo install -m 600 "$remote_dir/cloudflare.env" /etc/caddy/towbar/cloudflare.env
  sudo install -d -m 755 /etc/systemd/system/caddy.service.d
  printf '%s\n' '[Service]' 'EnvironmentFile=/etc/caddy/towbar/cloudflare.env' | sudo tee /etc/systemd/system/caddy.service.d/towbar.conf >/dev/null
  sudo systemctl daemon-reload
fi
sudo caddy fmt --overwrite "/etc/caddy/towbar/$app_id.caddy"
validate_args=(--config /etc/caddy/Caddyfile)
if sudo test -s /etc/caddy/towbar/cloudflare.env; then
  validate_args+=(--envfile /etc/caddy/towbar/cloudflare.env)
fi
sudo caddy validate "${"$"}{validate_args[@]}"
if sudo test -s /etc/caddy/towbar/cloudflare.env; then
  # The provider token is part of the Caddy service environment. A restart is
  # required on first install and token rotation; systemctl reload would keep
  # the previous service environment and fail closed with an empty token.
  sudo systemctl restart caddy
else
  sudo systemctl reload caddy
fi
`;

export const rollbackCandidateScript = String.raw`
set -euo pipefail
remote_dir="$1"
cleanup_id="$2"
container_name="$3"
image_tag="$4"
remove_image="$5"
previous_container="${"$"}{6:-}"
caddy_id="${"$"}{7:-$cleanup_id}"
docker rm -f "$container_name" >/dev/null 2>&1 || true
if test "$remove_image" = true; then docker image rm "$image_tag" >/dev/null 2>&1 || true; fi
if test -n "$previous_container" && docker container inspect "$previous_container" >/dev/null 2>&1; then
  docker start "$previous_container" >/dev/null
fi
if test -f "$remote_dir/caddy.previous.state"; then
  if test "$(cat "$remote_dir/caddy.previous.state")" = present; then
    sudo install -m 644 "$remote_dir/caddy.previous" "/etc/caddy/towbar/$caddy_id.caddy"
  else
    sudo rm -f "/etc/caddy/towbar/$caddy_id.caddy"
  fi
  if test -f "$remote_dir/cloudflare.previous.state"; then
    if test "$(cat "$remote_dir/cloudflare.previous.state")" = present; then
      sudo install -m 600 "$remote_dir/cloudflare.previous" /etc/caddy/towbar/cloudflare.env
      sudo install -d -m 755 /etc/systemd/system/caddy.service.d
      printf '%s\n' '[Service]' 'EnvironmentFile=/etc/caddy/towbar/cloudflare.env' | sudo tee /etc/systemd/system/caddy.service.d/towbar.conf >/dev/null
    else
      sudo rm -f /etc/caddy/towbar/cloudflare.env /etc/systemd/system/caddy.service.d/towbar.conf
    fi
    sudo systemctl daemon-reload
  fi
  validate_args=(--config /etc/caddy/Caddyfile)
  if sudo test -s /etc/caddy/towbar/cloudflare.env; then
    validate_args+=(--envfile /etc/caddy/towbar/cloudflare.env)
  fi
  if sudo caddy validate "${"$"}{validate_args[@]}"; then
    if sudo test -s /etc/caddy/towbar/cloudflare.env; then
      sudo systemctl restart caddy
    else
      sudo systemctl reload caddy
    fi
  fi
fi
rm -rf "$remote_dir"
`;

export const finalizeRemoteScript = String.raw`
set -euo pipefail
remote_dir="$1"
app_id="$2"
container_name="$3"
shift 3
docker ps -a --filter "label=towbar.app=$app_id" --format '{{.Names}}' | while read -r name; do
  if test -n "$name" && test "$name" != "$container_name"; then docker rm -f "$name" >/dev/null; fi
done
if (( $# > 0 )); then
  {
    docker images --filter "label=towbar.app=$app_id" --format '{{.Repository}}:{{.Tag}}'
    docker images "towbar/resource-$app_id" --format '{{.Repository}}:{{.Tag}}'
  } | sort -u | while read -r image; do
    keep=false
    for retained_image in "$@"; do
      if test "$image" = "$retained_image"; then keep=true; break; fi
    done
    if test "$keep" = false; then docker image rm "$image" >/dev/null 2>&1 || true; fi
  done
fi
rm -rf "$remote_dir"
`;

export const scheduleFinalizeRemoteScript = String.raw`
set -euo pipefail
remote_dir="$1"
app_id="$2"
container_name="$3"
delay_seconds="$4"
shift 4
retained_file="$remote_dir/retained-images"
printf '%s\n' "$@" >"$retained_file"
chmod 600 "$retained_file"
nohup bash -c '
  set -euo pipefail
  remote_dir="$1"
  app_id="$2"
  container_name="$3"
  delay_seconds="$4"
  retained_file="$5"
  sleep "$delay_seconds"
  docker ps -a --filter "label=towbar.app=$app_id" --format "{{.Names}}" | while read -r name; do
    if test -n "$name" && test "$name" != "$container_name"; then docker rm -f "$name" >/dev/null; fi
  done
  if test -s "$retained_file"; then
    {
      docker images --filter "label=towbar.app=$app_id" --format "{{.Repository}}:{{.Tag}}"
      docker images "towbar/resource-$app_id" --format "{{.Repository}}:{{.Tag}}"
    } | sort -u | while read -r image; do
      if ! grep -Fxq "$image" "$retained_file"; then docker image rm "$image" >/dev/null 2>&1 || true; fi
    done
  fi
  rm -rf "$remote_dir"
' -- "$remote_dir" "$app_id" "$container_name" "$delay_seconds" "$retained_file" \
  </dev/null >/dev/null 2>&1 &
`;
