#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export TOWBAR_DEMO_IMAGE="${TOWBAR_DEMO_IMAGE:-towbar-demo:test}"
export DEMO_ORIGIN=http://localhost:4880
export DEMO_SITE_ADDRESS=http://localhost:80
export DEMO_HTTP_BIND=127.0.0.1:4880
export DEMO_HTTPS_BIND=127.0.0.1:4881
compose=(docker compose --project-name towbar-demo-test --file infra/demo/compose.yml)
cleanup() {
  "${compose[@]}" logs --tail 60
  "${compose[@]}" down --volumes
}
trap cleanup EXIT
"${compose[@]}" config --quiet
"${compose[@]}" up --detach --wait --wait-timeout 120
node tools/demo-smoke.mjs "$DEMO_ORIGIN"
# Network probes run in the actual runtime container, independent of route policy.
"${compose[@]}" exec -T demo node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { connect } from 'node:net';
import { Resolver } from 'node:dns/promises';
assert.notEqual(process.getuid(), 0);
await assert.rejects(access('/var/run/docker.sock'));
await assert.rejects(access('/etc/towbar/config.yml'));
const resolver = new Resolver({ timeout: 1000, tries: 1 });
await assert.rejects(resolver.resolve4('example.com'));
for (const host of ['1.1.1.1', '169.254.169.254', '172.30.44.1']) {
  await new Promise((resolve, reject) => {
    const socket = connect({ host, port: 80 });
    socket.setTimeout(1500);
    socket.on('connect', () => { socket.destroy(); reject(new Error(`Unexpected outbound connectivity to ${host}`)); });
    socket.on('timeout', () => { socket.destroy(); resolve(); });
    socket.on('error', resolve);
  });
}
console.log('Runtime boundary passed: non-root, no Docker socket or host config, outbound DNS, internet, metadata and bridge host blocked.');
JS
# A process restart must invalidate every existing session.
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const origin = process.env.DEMO_ORIGIN;
const response = await fetch(`${origin}/__demo/start`, { method: 'POST', headers: { origin } });
assert.equal(response.status, 201);
const cookie = response.headers.get('set-cookie').split(';')[0];
execFileSync('docker', ['compose', '--project-name', 'towbar-demo-test', '--file', 'infra/demo/compose.yml', 'restart', 'demo'], { stdio: 'inherit' });
for (let attempt = 0; attempt < 30; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  try {
    const state = await fetch(`${origin}/__demo/session`, { headers: { cookie } });
    if (!state.ok) continue;
    assert.equal((await state.json()).active, false);
    console.log('Restart invalidated the old session.');
    process.exit(0);
  } catch { /* Gateway is restarting. */ }
}
throw new Error('Demo did not recover after restart');
JS
