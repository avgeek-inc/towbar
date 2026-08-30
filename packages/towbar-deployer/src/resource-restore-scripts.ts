export const preflightRestoreScript = String.raw`
set -euo pipefail
container="$1"
deployable_id="$2"
manifest_id="$3"
logical_name="$4"
backup_size="$5"
kind="$6"
expected_major="$7"
test "$(docker inspect --format '{{index .Config.Labels "towbar.managed"}}' "$container")" = true
owned="$(docker inspect --format '{{index .Config.Labels "towbar.deployable"}}' "$container")"
legacy="$(docker inspect --format '{{index .Config.Labels "towbar.app"}}' "$container")"
test "$owned" = "$deployable_id" || test "$legacy" = "$manifest_id"
state_dir="/var/lib/towbar/resources/$deployable_id/volumes"
sudo install -d -m 0755 -o "$(id -u)" -g "$(id -g)" "$state_dir"
pointer="$state_dir/$logical_name.active"
legacy_volume="towbar-$deployable_id-$logical_name"
if ! test -s "$pointer"; then
  printf '%s\n' "$legacy_volume" >"$pointer.tmp"
  mv "$pointer.tmp" "$pointer"
fi
active_volume="$(cat "$pointer")"
case "$active_volume" in towbar-*) ;; *) exit 65 ;; esac
test "$(docker volume inspect --format '{{index .Labels "towbar.managed"}}' "$active_volume")" = true
test "$(docker volume inspect --format '{{index .Labels "towbar.deployable"}}' "$active_volume")" = "$deployable_id"
mounted="$(docker inspect --format '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}' "$container")"
case " $mounted " in *" $active_volume "*) ;; *) exit 66 ;; esac
available="$(df -PB1 /var/lib/docker | awk 'NR==2 {print $4}')"
required=$((backup_size * 3))
if (( required < 1073741824 )); then required=1073741824; fi
if (( available < required )); then
  printf 'INSUFFICIENT_DISK:%s:%s\n' "$available" "$required" >&2
  exit 67
fi
if test "$kind" = postgres; then
  actual_major="$(docker exec "$container" postgres --version | sed -E 's/.* ([0-9]+)(\..*)?$/\1/')"
else
  actual_major="$(docker exec "$container" redis-server --version | sed -E 's/.*v=([0-9]+)(\..*)?.*/\1/')"
fi
test "$actual_major" = "$expected_major"
printf '%s\n%s\n%s\n' "$active_volume" "$available" "$actual_major"
`;

export const prepareCandidateScript = String.raw`
set -euo pipefail
candidate_volume="$1"
deployable_id="$2"
source_id="$3"
docker volume create \
  --label towbar.managed=true \
  --label "towbar.deployable=$deployable_id" \
  --label "towbar.source=$source_id" \
  --label towbar.restore-candidate=true \
  "$candidate_volume" >/dev/null
`;

export const restoreCandidateScript = String.raw`
set -euo pipefail
kind="$1"
container="$2"
volume="$3"
mount_path="$4"
backup_path="$5"
image="$6"
resource_cpus="$7"
resource_memory="$8"
runtime_dir="$9"
shift 9
docker rm -f "$container" >/dev/null 2>&1 || true
run_candidate() {
  runtime_args=(--mount "type=volume,src=$volume,dst=$mount_path")
  if test -n "$resource_cpus"; then runtime_args+=(--cpus "$resource_cpus"); fi
  if test -n "$resource_memory"; then runtime_args+=(--memory "$resource_memory"); fi
  command=(/usr/bin/docker run -d "${"$"}{runtime_args[@]}" --name "$container" --restart no "$image")
  if (( $# > 0 )); then command+=("$@"); fi
  /usr/bin/python3 - "$runtime_dir" "${"$"}{command[@]}" <<'PYTHON' >/dev/null
import os
from pathlib import Path
import sys

runtime_directory = Path(sys.argv[1])
command = sys.argv[2:]
runtime_arguments = []
for secret_path in sorted(runtime_directory.iterdir()):
    if secret_path.is_file():
        os.environ[secret_path.name] = secret_path.read_text(encoding="utf-8")
        runtime_arguments.extend(("--env", secret_path.name))
command[3:3] = runtime_arguments
os.execve(command[0], command, os.environ)
PYTHON
}
if test "$kind" = redis; then
  docker run --rm --user 0 \
    --mount "type=bind,src=$backup_path,dst=/tmp/towbar-restore.rdb,readonly" \
    --mount "type=volume,src=$volume,dst=$mount_path" \
    --entrypoint sh "$image" -c "cp /tmp/towbar-restore.rdb '$mount_path/dump.rdb'"
fi
run_candidate "$@"
deadline=$((SECONDS + 120))
while true; do
  if test "$kind" = postgres && docker exec "$container" sh -c 'pg_isready -U "${"$"}{POSTGRES_USER:-postgres}" -d "${"$"}{POSTGRES_DB:-postgres}"' >/dev/null 2>&1; then break; fi
  if test "$kind" = redis && docker exec "$container" sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PING' | grep -Fxq PONG; then break; fi
  if (( SECONDS >= deadline )); then exit 68; fi
  sleep 2
done
if test "$kind" = postgres; then
  docker cp "$backup_path" "$container:/tmp/towbar-restore.dump"
  docker exec "$container" sh -c 'exec pg_restore -U "${"$"}{POSTGRES_USER:-postgres}" -d "${"$"}{POSTGRES_DB:-postgres}" --clean --if-exists --no-owner --no-privileges /tmp/towbar-restore.dump'
  docker exec "$container" rm -f /tmp/towbar-restore.dump
  docker exec "$container" sh -c 'psql -U "${"$"}{POSTGRES_USER:-postgres}" -d "${"$"}{POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null'
  docker exec "$container" sh -c 'psql -U "${"$"}{POSTGRES_USER:-postgres}" -d postgres -Atqc "SELECT 1 FROM pg_database WHERE datname = '\''${"$"}{POSTGRES_DB:-postgres}'\''"' | grep -Fxq 1
else
  docker exec "$container" redis-check-rdb "$mount_path/dump.rdb" >/dev/null
  docker exec "$container" sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PING' | grep -Fxq PONG
  docker exec "$container" sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning DBSIZE' | grep -Eq '^[0-9]+$'
fi
`;

export const promoteCandidateScript = String.raw`
set -euo pipefail
kind="$1"
current_container="$2"
candidate_container="$3"
candidate_volume="$4"
previous_volume="$5"
pointer="$6"
mount_path="$7"
image="$8"
network_name="$9"
network_alias="${"$"}{10}"
host_port="${"$"}{11}"
container_port="${"$"}{12}"
resource_cpus="${"$"}{13}"
resource_memory="${"$"}{14}"
runtime_dir="${"$"}{15}"
deployable_id="${"$"}{16}"
manifest_id="${"$"}{17}"
source_id="${"$"}{18}"
deployment_id="${"$"}{19}"
commit_sha="${"$"}{20}"
shift 20
switch_pointer() {
  printf '%s\n' "$1" >"$pointer.tmp"
  mv "$pointer.tmp" "$pointer"
}
run_runtime() {
  selected_volume="$1"
  shift
  runtime_args=(--mount "type=volume,src=$selected_volume,dst=$mount_path")
  if test -n "$network_name"; then
    runtime_args+=(--network "$network_name")
    if test -n "$network_alias"; then runtime_args+=(--network-alias "$network_alias"); fi
  fi
  if test -n "$host_port" && test -n "$container_port"; then runtime_args+=(-p "127.0.0.1:$host_port:$container_port"); fi
  if test -n "$resource_cpus"; then runtime_args+=(--cpus "$resource_cpus"); fi
  if test -n "$resource_memory"; then runtime_args+=(--memory "$resource_memory"); fi
  command=(/usr/bin/docker run -d "${"$"}{runtime_args[@]}" \
    --name "$current_container" --restart unless-stopped \
    --add-host host.docker.internal:host-gateway \
    --env "SOURCE_COMMIT=$commit_sha" \
    --env "TOWBAR_APP_ID=$manifest_id" \
    --env "TOWBAR_COMMIT_SHA=$commit_sha" \
    --env "TOWBAR_DEPLOYMENT_ID=$deployment_id" \
    --label towbar.managed=true \
    --label "towbar.app=$manifest_id" \
    --label "towbar.resource=$deployable_id" \
    --label "towbar.deployable=$deployable_id" \
    --label "towbar.source=$source_id" \
    --label "towbar.deployment=$deployment_id" \
    "$image")
  if (( $# > 0 )); then command+=("$@"); fi
  /usr/bin/python3 - "$runtime_dir" "${"$"}{command[@]}" <<'PYTHON' >/dev/null
import os
from pathlib import Path
import sys

runtime_directory = Path(sys.argv[1])
command = sys.argv[2:]
runtime_arguments = []
for secret_path in sorted(runtime_directory.iterdir()):
    if secret_path.is_file():
        os.environ[secret_path.name] = secret_path.read_text(encoding="utf-8")
        runtime_arguments.extend(("--env", secret_path.name))
command[3:3] = runtime_arguments
os.execve(command[0], command, os.environ)
PYTHON
}
validate_runtime() {
  deadline=$((SECONDS + 120))
  while true; do
    if test "$kind" = postgres && docker exec "$current_container" sh -c 'pg_isready -U "${"$"}{POSTGRES_USER:-postgres}" -d "${"$"}{POSTGRES_DB:-postgres}"' >/dev/null 2>&1 && docker exec "$current_container" sh -c 'psql -U "${"$"}{POSTGRES_USER:-postgres}" -d "${"$"}{POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null'; then return 0; fi
    if test "$kind" = redis && docker exec "$current_container" sh -c 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning PING' | grep -Fxq PONG; then return 0; fi
    if (( SECONDS >= deadline )); then return 1; fi
    sleep 2
  done
}
docker rm -f "$candidate_container" >/dev/null 2>&1 || true
docker rm -f "$current_container" >/dev/null
switch_pointer "$candidate_volume"
if run_runtime "$candidate_volume" "$@" && validate_runtime; then
  printf 'PROMOTED\n'
  exit 0
fi
docker rm -f "$current_container" >/dev/null 2>&1 || true
switch_pointer "$previous_volume"
if run_runtime "$previous_volume" "$@" && validate_runtime; then
  docker volume rm "$candidate_volume" >/dev/null 2>&1 || true
  printf 'ROLLED_BACK\n'
  exit 0
fi
printf 'ROLLBACK_FAILED\n' >&2
exit 70
`;

export const cleanupRestoreVolumesScript = String.raw`
set -euo pipefail
deployable_id="$1"
shift
state_dir="/var/lib/towbar/resources/$deployable_id/volumes"
active="$(cat "$state_dir"/*.active 2>/dev/null || true)"
cleaned=()
skipped=()
for volume in "$@"; do
  case "$volume" in towbar-*) ;; *) skipped+=("$volume"); continue ;; esac
  if grep -Fxq "$volume" <<<"$active"; then skipped+=("$volume"); continue; fi
  if ! docker volume inspect "$volume" >/dev/null 2>&1; then skipped+=("$volume"); continue; fi
  if test "$(docker volume inspect --format '{{index .Labels "towbar.managed"}}' "$volume")" != true || test "$(docker volume inspect --format '{{index .Labels "towbar.deployable"}}' "$volume")" != "$deployable_id"; then
    skipped+=("$volume")
    continue
  fi
  if docker volume rm "$volume" >/dev/null 2>&1; then cleaned+=("$volume"); else skipped+=("$volume"); fi
done
python3 - "${"$"}{cleaned[*]}" "${"$"}{skipped[*]}" <<'PYTHON'
import json
import sys
print(json.dumps({"cleaned": sys.argv[1].split() if sys.argv[1] else [], "skipped": sys.argv[2].split() if sys.argv[2] else []}, separators=(",", ":")))
PYTHON
`;
