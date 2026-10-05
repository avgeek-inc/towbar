#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
registry="$(node -p 'require("./repository.json").imageRegistry')"
image="${1:?Usage: tools/deploy-public-demo.sh REGISTRY/towbar-demo@sha256:DIGEST}"
digest="${image#"$registry/towbar-demo@sha256:"}"
[[ "$digest" != "$image" && "$digest" =~ ^[a-f0-9]{64}$ ]] || {
  echo 'Use the immutable digest from the public demo publishing workflow.' >&2
  exit 1
}
[[ "$(uname -m)" == aarch64 ]] || { echo 'The published demo artifact requires an arm64 host.' >&2; exit 1; }
node --input-type=module -e 'if (Number(process.versions.node.split(".")[0]) < 24) process.exit(1)'
# Each host runs one instance. Serialize updates, including rollback and state writes.
exec 9>infra/demo/.deploy.lock
flock -n 9 || { echo 'Another demo update is running.' >&2; exit 1; }
unset TOWBAR_DEMO_IMAGE DEMO_ORIGIN DEMO_SITE_ADDRESS DEMO_HTTP_BIND DEMO_HTTPS_BIND
state="$PWD/infra/demo/.env"
candidate="$(mktemp "$PWD/infra/demo/.env.next.XXXXXX")"
chmod 600 "$candidate"
printf 'TOWBAR_DEMO_IMAGE=%s\nDEMO_ORIGIN=https://try.towbar.dev\n' "$image" > "$candidate"
compose=(docker compose --project-name towbar-demo --env-file "$candidate" --file infra/demo/compose.yml)
changed=false
cleanup() {
  code=$?
  rm -f "$candidate"
  if [[ "$code" != 0 && "$changed" == true ]]; then
    if [[ -f "$state" ]]; then
      echo 'Demo validation failed; restoring the previous configuration.' >&2
      docker compose --project-name towbar-demo --env-file "$state" --file infra/demo/compose.yml up --detach --wait --wait-timeout 120 || true
    else
      echo 'Initial activation failed; stopping the new stack. Fix DNS/TLS or the reported error, then retry.' >&2
      TOWBAR_DEMO_IMAGE="$image" docker compose --project-name towbar-demo --file infra/demo/compose.yml down || true
    fi
  fi
  exit "$code"
}
trap cleanup EXIT
"${compose[@]}" config --quiet
"${compose[@]}" pull
changed=true
"${compose[@]}" up --detach --wait --wait-timeout 120
# Allow initial ACME issuance to finish before running the complete public smoke.
curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 --max-time 10 https://try.towbar.dev/health >/dev/null
node tools/demo-smoke.mjs https://try.towbar.dev
if [[ -f "$state" ]]; then cp "$state" infra/demo/.env.previous; fi
mv "$candidate" "$state"
changed=false
printf 'Demo activated: %s\n' "$image"
