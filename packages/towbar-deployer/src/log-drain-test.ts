import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { LogDrainCredential } from "@workspace/towbar-core";
import {
  type LogDrainExecutionContext,
  buildLogDrainConfiguration,
  buildLogDrainGatewayConfiguration,
  logDrainGatewayImage,
  logDrainGatewayOrigin,
  logDrainImage,
  readLogDrainHealth,
} from "./log-drains.js";
import { SshSession } from "./ssh.js";

export function buildLogDrainTestConfiguration(
  serverId: string,
  credential: LogDrainCredential,
  testId: string,
  gateway?: string,
) {
  const containerName = `towbar-delivery-test-${testId}`;
  const config = buildLogDrainConfiguration(
    serverId,
    [
      {
        kind: "container",
        containerName,
        appId: testId,
        deploymentId: testId,
        repositoryId: testId,
        teamId: serverId,
        name: "Towbar delivery test",
        environment: "test",
        providers: [credential.provider],
      },
    ],
    [credential],
    { gateway },
  )!;
  const sink = config.sinks[credential.provider] as Record<string, unknown>;
  sink.buffer = { type: "memory", max_events: 10 };
  const transport = (sink.protocol ?? sink) as Record<string, unknown>;
  const request = (transport.request ?? {}) as Record<string, unknown>;
  transport.request = {
    ...request,
    headers: {
      ...((request.headers ?? {}) as Record<string, string>),
      "X-Towbar-Delivery-Test": testId,
    },
    timeout_secs: 10,
    retry_attempts: 0,
  };
  return {
    ...config,
    data_dir: "/tmp",
    sources: {
      containers: {
        type: "demo_logs",
        format: "shuffle",
        lines: [`Towbar log forwarding test ${testId}`],
        count: 1,
        interval: 0.01,
      },
    },
    transforms: {
      ...config.transforms,
      test_record: {
        type: "remap",
        inputs: ["containers"],
        source: `.container_name = ${JSON.stringify(containerName)}\n.stream = "stdout"`,
      },
      [`select_${credential.provider}`]: {
        type: "filter",
        inputs: ["test_record"],
        condition: "true",
      },
    },
  };
}

export const logDrainTestScript = `set -euo pipefail
staging="$1"
name="$2"
image="$3"
server="$4"
gateway_image="$5"
provider="$6"
revision="$7"
test_id="$8"
base="/var/lib/towbar/log-drains/$server"
receipt="$base/state/test-receipt-$test_id.json"
install -d -m 0700 "$base" "$base/state"
exec 9>"$base/lock"
flock -w 30 9
gateway="towbar-log-delivery-$server"
temporary_gateway=""
cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  if test -n "$temporary_gateway"; then docker rm -f "$temporary_gateway" >/dev/null 2>&1 || true; fi
  rm -f -- "$receipt"
  rm -rf -- "$staging"
}
trap cleanup EXIT
rm -f -- "$receipt"
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image" >/dev/null 2>&1
chown -R root:root "$staging"
chmod 0600 "$staging/vector.json"
if test "$(docker inspect -f '{{.State.Running}}' "$gateway" 2>/dev/null || true)" = true; then
  docker exec "$gateway" python -c 'import json,sys; c=json.load(open("/etc/towbar/gateway.json")); sys.exit(0 if c.get(sys.argv[1],{}).get("revision")==sys.argv[2] else 1)' "$provider" "$revision"
else
  docker image inspect "$gateway_image" >/dev/null 2>&1 || docker pull "$gateway_image" >/dev/null 2>&1
  gateway="$name-gateway"
  temporary_gateway="$gateway"
  docker run -d --name "$gateway" --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --cpus 0.25 --pids-limit 32 --log-driver local --log-opt max-size=1m --log-opt max-file=2 --mount "type=bind,src=$staging,dst=/etc/towbar,readonly" --mount "type=bind,src=$base/state,dst=/state" "$gateway_image" python -B /etc/towbar/gateway.py /etc/towbar/gateway.json /state/status.json >/dev/null
fi
gateway_ready=false
for attempt in $(seq 1 50); do
  if docker exec "$gateway" python -c 'import socket; socket.create_connection(("127.0.0.1", 8787), 0.2).close()' >/dev/null 2>&1; then gateway_ready=true; break; fi
  sleep 0.2
done
test "$gateway_ready" = true
docker run -d --name "$name" --network "container:$gateway" --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 0.5 --pids-limit 64 --tmpfs /tmp --log-driver local --log-opt max-size=1m --log-opt max-file=2 --mount "type=bind,src=$staging/vector.json,dst=/etc/vector/vector.json,readonly" "$image" --config /etc/vector/vector.json >/dev/null
for attempt in $(seq 1 25); do
  if test -s "$receipt" && python3 - "$receipt" "$provider" "$revision" "$test_id" <<'PYTHON'
import json
import sys
with open(sys.argv[1]) as handle:
    receipt = json.load(handle)
raise SystemExit(0 if receipt == {
    "provider": sys.argv[2],
    "revision": sys.argv[3],
    "testId": sys.argv[4],
    "sent": True,
} else 1)
PYTHON
  then exit 0; fi
  if test -s "$base/state/status.json" && python3 - "$base/state/status.json" "$provider" "$revision" <<'PYTHON'
import json
import sys
with open(sys.argv[1]) as handle:
    state = json.load(handle).get(sys.argv[2], {})
raise SystemExit(0 if state.get("revision") == sys.argv[3] and state.get("status") in ("auth_failure", "rate_limited") else 1)
PYTHON
  then exit 1; fi
  test "$(docker inspect -f '{{.State.Running}}' "$name")" = true || exit 1
  sleep 1
done
exit 1
`;

export async function testLogDrainDelivery(
  context: Omit<LogDrainExecutionContext, "targets" | "credentials"> & {
    credential: LogDrainCredential;
    testId: string;
  },
  signal?: AbortSignal,
) {
  if (!/^[0-9a-f-]{36}$/.test(context.testId))
    throw new Error("Invalid delivery test ID");
  const session = await SshSession.connect({
    server: context.config,
    login: context.login,
    trustedHostKeys: context.trustedHostKeys,
  });
  const local = await mkdtemp(path.join(tmpdir(), "towbar-drain-test-"));
  let staging: string | undefined;
  const name = `towbar-log-test-${context.testId}`;
  try {
    staging = (
      await session.run(
        "umask 077; mktemp -d /tmp/towbar-log-test.XXXXXXXX",
        [],
        { signal, timeoutMs: 10_000 },
      )
    ).stdout.trim();
    if (!/^\/tmp\/towbar-log-test\.[a-zA-Z0-9]{8}$/.test(staging))
      throw new Error("Unable to stage delivery test");
    const configuration = buildLogDrainTestConfiguration(
      context.serverId,
      context.credential,
      context.testId,
      logDrainGatewayOrigin,
    );
    const gatewayConfiguration = buildLogDrainGatewayConfiguration({
      credentials: [context.credential],
      revisions: context.revisions,
      health: context.health,
    });
    for (const [file, content] of Object.entries({
      "vector.json": JSON.stringify(configuration).replaceAll("$", "\\u0024"),
      "test.sh": logDrainTestScript,
      "gateway.json": JSON.stringify(gatewayConfiguration),
      "gateway.py": await readFile(
        new URL("./log-drain-gateway.py", import.meta.url),
        "utf8",
      ),
    })) {
      const source = path.join(local, file);
      await writeFile(source, content, { mode: 0o600 });
      await session.upload(source, `${staging}/${file}`, {
        signal,
        timeoutMs: 10_000,
      });
    }
    let sent = false;
    try {
      await session.run(
        'sudo -n timeout --signal=TERM 110 bash "$1/test.sh" "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"',
        [
          staging,
          name,
          logDrainImage,
          context.serverId,
          logDrainGatewayImage,
          context.credential.provider,
          gatewayConfiguration[context.credential.provider]!.revision,
          context.testId,
        ],
        { signal, timeoutMs: 115_000 },
      );
      sent = true;
    } catch {
      if (signal?.aborted) throw new Error("Log delivery test cancelled");
    }
    return {
      sent,
      health: await readLogDrainHealth(session, context.serverId),
    };
  } finally {
    if (staging)
      await session
        .run(
          'sudo -n docker rm -f "$1" "$1-gateway" >/dev/null 2>&1 || true; sudo -n rm -rf -- "$2"',
          [name, staging],
          { timeoutMs: 10_000 },
        )
        .catch(() => undefined);
    await rm(local, { recursive: true, force: true });
    await session.close();
  }
}
