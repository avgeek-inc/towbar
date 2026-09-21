import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type LogDrainCredential,
  type LogDrainHealth,
  type LogDrainTarget,
  type NormalizedServer,
  logDrainCredentialSchema,
  logDrainEndpoint,
  logDrainHealthListSchema,
} from "@workspace/towbar-core";
import { SshSession } from "./ssh.js";
import type { SshLoginSecret, TrustedHostKey } from "./types.js";

export const logDrainImage =
  "timberio/vector:0.58.0-alpine@sha256:5dcf67db0ee378caa87f3395cb9484ebe3e97bb0334d119f2ac33116e00c5773";
export const logDrainGatewayImage =
  "python:3.13-alpine@sha256:7415fbc3c9e4979cc717d92377ab2bc7b2b4a2af1ac03cc52b5f3f88efedaf3a";
export const logDrainGatewayOrigin = "http://127.0.0.1:8787";
export type LogDrainExecutionContext = {
  revisions?: Record<string, string>;
  health?: LogDrainHealth[];
  serverId: string;
  config: NormalizedServer;
  login: SshLoginSecret;
  trustedHostKeys: TrustedHostKey[];
  targets: LogDrainTarget[];
  credentials: LogDrainCredential[];
};

const otlpFormat = `
. = {"resourceLogs": [{
  "resource": {"attributes": [
    {"key": "service.name", "value": {"stringValue": .service}},
    {"key": "deployment.environment.name", "value": {"stringValue": .environment}},
    {"key": "container.name", "value": {"stringValue": .container_name}},
    {"key": "towbar.app.id", "value": {"stringValue": .app_id}},
    {"key": "towbar.compose.service", "value": {"stringValue": .compose_service}},
    {"key": "towbar.deployment.id", "value": {"stringValue": .deployment_id}},
    {"key": "towbar.repository.id", "value": {"stringValue": .repository_id}},
    {"key": "towbar.server.id", "value": {"stringValue": .server_id}},
    {"key": "towbar.team.id", "value": {"stringValue": .team_id}}
  ]},
  "scopeLogs": [{"scope": {"name": "towbar.container-logs"}, "logRecords": [{
    "timeUnixNano": to_unix_timestamp!(.timestamp, unit: "nanoseconds"),
    "body": {"stringValue": .message},
    "attributes": [{"key": "log.iostream", "value": {"stringValue": .stream}}]
  }]}]
}]}`;

function buildSink(
  credential: LogDrainCredential,
  serverId: string,
  gateway?: string,
) {
  const inputs = [`format_${credential.provider}`];
  const buffer = {
    type: "disk",
    max_size: 268435488,
    when_full: "drop_newest",
  };
  const batch = { max_bytes: 1024 * 1024, max_events: 500, timeout_secs: 5 };
  const request = {
    timeout_secs: 30,
    concurrency: 1,
    retry_initial_backoff_secs: 5,
    retry_max_duration_secs: 300,
    retry_jitter_mode: "Full",
  };
  const common = {
    inputs,
    buffer,
    batch,
    request,
    healthcheck: { enabled: false },
  };
  const tls =
    "caCertificate" in credential && credential.caCertificate
      ? {
          ca_file: credential.caCertificate,
          verify_certificate: true,
          verify_hostname: true,
        }
      : { verify_certificate: true, verify_hostname: true };
  const auth =
    "auth" in credential
      ? credential.auth === "basic"
        ? {
            strategy: "basic",
            user: credential.username,
            password: credential.apiKey,
          }
        : credential.auth === "bearer"
          ? { strategy: "bearer", token: credential.apiKey }
          : undefined
      : undefined;
  const endpoint = logDrainEndpoint(credential);
  const destination = gateway
    ? `${gateway}/${credential.provider}`
    : endpoint.url;
  if (credential.provider === "loki") {
    const url = new URL(destination);
    return {
      ...common,
      type: "loki",
      endpoint: url.origin,
      path: url.pathname,
      auth,
      tls,
      compression: "gzip",
      encoding: { codec: "json" },
      request: { ...request, headers: endpoint.headers },
      labels: {
        service_name: "{{ service }}",
        environment: "{{ environment }}",
        server_id: "{{ server_id }}",
      },
      ...(credential.tenantId ? { tenant_id: credential.tenantId } : {}),
    };
  }
  const http = {
    uri: destination,
    method: "post",
    auth,
    tls,
    compression: "gzip",
    encoding: { codec: "json" },
    batch,
    request: { ...request, headers: endpoint.headers },
  };
  if (credential.provider === "otlp")
    return {
      type: "opentelemetry",
      inputs,
      buffer,
      healthcheck: { enabled: false },
      protocol: { ...http, type: "http", encoding: { codec: "otlp" } },
    };
  return { ...common, ...http, type: "http" };
}

export function buildLogDrainConfiguration(
  serverId: string,
  targets: LogDrainTarget[],
  rawCredentials: LogDrainCredential[],
  options: { gateway?: string } = {},
) {
  const credentials = rawCredentials.map((credential) =>
    logDrainCredentialSchema.parse(credential),
  );
  const transforms: Record<string, unknown> = {};
  const sinks: Record<string, unknown> = {};
  const names = new Set<string>();
  for (const credential of credentials) {
    const selected = targets.filter((target) =>
      target.providers.includes(credential.provider),
    );
    if (!selected.length) continue;
    const provider = credential.provider;
    const metadata = Object.fromEntries(
      selected.map((target) => {
        if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,254}$/.test(target.containerName))
          throw new Error("Invalid log container name");
        names.add(target.containerName);
        return [
          target.containerName,
          {
            service: target.name,
            app_id: target.appId,
            compose_service: target.composeService ?? "",
            deployment_id: target.deploymentId,
            environment: target.environment,
            repository_id: target.repositoryId,
            server_id: serverId,
            team_id: target.teamId,
          },
        ];
      }),
    );
    transforms[`select_${provider}`] = {
      type: "filter",
      inputs: ["containers"],
      condition: `includes(${JSON.stringify(Object.keys(metadata))}, .container_name)`,
    };
    const extra =
      provider === "otlp"
        ? otlpFormat
        : provider === "axiom"
          ? "._time = del(.timestamp)"
          : provider === "betterstack"
            ? ".dt = del(.timestamp)"
            : provider === "newrelic"
              ? '. = {"logs": [.]}'
              : provider === "datadog"
                ? '.ddsource = "towbar"\n.hostname = .server_id'
                : "";
    transforms[`format_${provider}`] = {
      type: "remap",
      inputs: [`select_${provider}`],
      drop_on_error: true,
      source: `metadata = ${JSON.stringify(metadata)}\nname = string!(.container_name)\ncontext = object!(get!(metadata, [name]))\n. = merge({"message": .message, "timestamp": .timestamp, "container_name": .container_name, "stream": .stream}, context)\n${extra}`,
    };
    sinks[provider] = buildSink(credential, serverId, options.gateway);
  }
  if (!names.size) return null;
  return {
    data_dir: "/var/lib/vector",
    api: { enabled: false },
    sources: {
      containers: {
        type: "docker_logs",
        include_containers: [...names].sort(),
        include_labels: ["towbar.managed=true"],
        auto_partial_merge: false,
      },
    },
    transforms,
    sinks,
  };
}

export function buildLogDrainGatewayConfiguration(
  context: Pick<
    LogDrainExecutionContext,
    "credentials" | "revisions" | "health"
  >,
) {
  return Object.fromEntries(
    context.credentials.map((credential) => {
      const revision =
        context.revisions?.[credential.provider] ??
        createHash("sha256").update(JSON.stringify(credential)).digest("hex");
      return [
        credential.provider,
        {
          endpoint: logDrainEndpoint(credential).url,
          caCertificate:
            "caCertificate" in credential ? credential.caCertificate : "",
          revision,
          health: context.health?.find(
            (item) =>
              item.provider === credential.provider &&
              item.revision === revision,
          ),
        },
      ];
    }),
  );
}

export async function readLogDrainHealth(
  session: SshSession,
  serverId: string,
): Promise<LogDrainHealth[]> {
  if (!/^[0-9a-f-]{36}$/.test(serverId)) throw new Error("Invalid log server");
  const output = await session.run(
    'sudo -n head -c 65537 "/var/lib/towbar/log-drains/$1/state/status.json"',
    [serverId],
    { timeoutMs: 10_000 },
  );
  if (output.stdout.length > 65536)
    throw new Error("Invalid log delivery status");
  return logDrainHealthListSchema.parse(
    Object.values(JSON.parse(output.stdout)),
  );
}

export const logDrainInstallScript = `set -euo pipefail
staging="$1"
server="$2"
digest="$3"
credential_digest="$4"
image="$5"
gateway_image="$6"
buffer_budget="$7"
base="/var/lib/towbar/log-drains/$server"
name="towbar-log-drains-$server"
gateway_name="towbar-log-delivery-$server"
install -d -m 0700 "$base"
exec 9>"$base/lock"
flock -w 30 9
stage="initializing"
trap 'printf "Log forwarder %s failed\\n" "$stage" >&2' ERR
trap 'rm -rf -- "$staging" "$base/candidate"' EXIT
if test ! -s "$staging/vector.json"; then
  if docker container inspect "$name" >/dev/null 2>&1; then docker rm -f "$name" >/dev/null; fi
  docker rm -f "$gateway_name" >/dev/null 2>&1 || true
  rm -rf -- "$base/config" "$base/buffer" "$base/state"
  rm -f "$base/digest" "$base/credentials" "$base/vector-image" "$base/gateway-image"
  exit 0
fi
if test "$(cat "$base/digest" 2>/dev/null || true)" = "$digest" && test "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" = true && test "$(docker inspect -f '{{.State.Running}}' "$gateway_name" 2>/dev/null || true)" = true; then exit 0; fi
stage="disk capacity check"
available=$(df -PB1 "$base" | awk 'NR==2 {print $4}')
used=$(du -sb "$base/buffer" 2>/dev/null | cut -f1 || true)
test -n "$used" || used=0
test "$((available + used))" -ge "$((buffer_budget + 1073741824))"
stage="image pull"
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image" >/dev/null
docker image inspect "$gateway_image" >/dev/null 2>&1 || docker pull "$gateway_image" >/dev/null
# Validate before interrupting a working forwarder. No provider request is made here.
stage="configuration validation"
install -d -m 0700 "$base/candidate"
install -m 0600 "$staging/vector.json" "$base/candidate/vector.json"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 0.5 --pids-limit 64 --mount "type=bind,src=$base/candidate,dst=/etc/vector,readonly" "$image" validate --no-environment --skip-healthchecks /etc/vector/vector.json >/dev/null 2>&1
rm -rf -- "$base/previous-config" "$base/previous-buffer" "$base/previous-state"
previous_image="$(cat "$base/vector-image" 2>/dev/null || printf '%s' "$image")"
previous_gateway_image="$(cat "$base/gateway-image" 2>/dev/null || printf '%s' "$gateway_image")"
had_previous=false
state_moved=false
if test -d "$base/config"; then mv "$base/config" "$base/previous-config"; had_previous=true; fi
# Never forward queued data to a newly configured provider account. Keep the
# old queue only long enough to support an atomic rollback.
if test "$(cat "$base/credentials" 2>/dev/null || true)" != "$credential_digest"; then
  if test -d "$base/buffer"; then mv "$base/buffer" "$base/previous-buffer"; fi
  if test -d "$base/state"; then mv "$base/state" "$base/previous-state"; fi
  state_moved=true
fi
install -d -m 0700 "$base/config" "$base/buffer" "$base/state"
install -m 0600 "$staging/gateway.json" "$base/config/gateway.json"
install -m 0600 "$staging/gateway.py" "$base/config/gateway.py"
install -m 0600 "$staging/vector.json" "$base/config/vector.json"
stop_pair() {
  docker rm -f "$name" "$gateway_name" >/dev/null 2>&1 || true
}
run_pair() {
  local vector_image="$1" delivery_image="$2"
  docker run -d --name "$gateway_name" --label towbar.log-drain=true --restart unless-stopped --read-only --cap-drop ALL --security-opt no-new-privileges --memory 128m --cpus 0.25 --pids-limit 32 --log-driver local --log-opt max-size=1m --log-opt max-file=2 --mount "type=bind,src=$base/config,dst=/etc/towbar,readonly" --mount "type=bind,src=$base/state,dst=/state" "$delivery_image" python -B /etc/towbar/gateway.py /etc/towbar/gateway.json /state/status.json >/dev/null || return 1
  if ! docker run -d --name "$name" --network "container:$gateway_name" --label towbar.log-drain=true --restart unless-stopped --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 0.5 --pids-limit 64 --log-driver local --log-opt max-size=5m --log-opt max-file=2 --mount "type=bind,src=$base/config,dst=/etc/vector,readonly" --mount "type=bind,src=$base/buffer,dst=/var/lib/vector" --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock,readonly "$vector_image" --config /etc/vector/vector.json >/dev/null; then
    stop_pair
    return 1
  fi
}
restore_previous() {
  stop_pair
  rm -rf -- "$base/config"
  if test "$state_moved" = true; then
    rm -rf -- "$base/buffer" "$base/state"
    if test -d "$base/previous-buffer"; then mv "$base/previous-buffer" "$base/buffer"; else install -d -m 0700 "$base/buffer"; fi
    if test -d "$base/previous-state"; then mv "$base/previous-state" "$base/state"; else install -d -m 0700 "$base/state"; fi
  fi
  if test "$had_previous" = true; then
    mv "$base/previous-config" "$base/config"
    run_pair "$previous_image" "$previous_gateway_image" || true
  fi
}
stop_pair
stage="startup"
if ! run_pair "$image" "$gateway_image"; then restore_previous; exit 1; fi
stage="startup check"
ready=false
stable=0
for attempt in $(seq 1 30); do
  if test "$(docker inspect -f '{{.State.Running}}' "$gateway_name")" = true && test "$(docker inspect -f '{{.State.Running}}' "$name")" = true && docker exec "$gateway_name" python -c 'import json,socket; json.load(open("/state/status.json")); socket.create_connection(("127.0.0.1",8787),timeout=1).close()' >/dev/null 2>&1; then
    stable=$((stable + 1))
    if test "$stable" -ge 3; then ready=true; break; fi
  else
    stable=0
  fi
  sleep 1
done
if test "$ready" != true; then restore_previous; exit 1; fi
printf '%s' "$digest" >"$base/digest"
printf '%s' "$credential_digest" >"$base/credentials"
printf '%s' "$image" >"$base/vector-image"
printf '%s' "$gateway_image" >"$base/gateway-image"
chmod 0600 "$base/digest" "$base/credentials" "$base/vector-image" "$base/gateway-image"
rm -rf -- "$base/previous-config" "$base/previous-buffer" "$base/previous-state"
`;

export async function reconcileLogDrains(
  context: LogDrainExecutionContext,
  signal?: AbortSignal,
) {
  if (!/^[0-9a-f-]{36}$/.test(context.serverId))
    throw new Error("Invalid log server");
  const session = await SshSession.connect({
    server: context.config,
    login: context.login,
    trustedHostKeys: context.trustedHostKeys,
  });
  let staging: string | undefined;
  const local = await mkdtemp(path.join(tmpdir(), "towbar-log-drains-"));
  try {
    const configuration = buildLogDrainConfiguration(
      context.serverId,
      context.targets,
      context.credentials,
      { gateway: logDrainGatewayOrigin },
    );
    const gatewayConfiguration = buildLogDrainGatewayConfiguration(context);
    const gatewayScript = await readFile(
      new URL("./log-drain-gateway.py", import.meta.url),
      "utf8",
    );
    // Vector expands environment references even inside JSON configuration strings.
    const text = configuration
      ? JSON.stringify(configuration).replaceAll("$", "\\u0024")
      : "";
    const digest = createHash("sha256")
      .update(
        text +
          JSON.stringify(
            Object.fromEntries(
              Object.entries(gatewayConfiguration).map(
                ([provider, { health: _health, ...config }]) => [
                  provider,
                  config,
                ],
              ),
            ),
          ) +
          gatewayScript,
      )
      .digest("hex");
    const credentialDigest = createHash("sha256")
      .update(JSON.stringify(context.credentials))
      .digest("hex");
    if (configuration) {
      const unchanged = await session
        .run(
          `sudo -n test "$(sudo -n cat "/var/lib/towbar/log-drains/$1/digest" 2>/dev/null)" = "$2" && test "$(sudo -n docker inspect -f '{{.State.Running}}' "towbar-log-drains-$1" 2>/dev/null)" = true && test "$(sudo -n docker inspect -f '{{.State.Running}}' "towbar-log-delivery-$1" 2>/dev/null)" = true`,
          [context.serverId, digest],
          { signal, timeoutMs: 10_000 },
        )
        .then(
          () => true,
          () => false,
        );
      if (unchanged)
        return {
          digest,
          active: true,
          health: await readLogDrainHealth(session, context.serverId),
        };
    }
    staging = (
      await session.run(
        "umask 077; mktemp -d /tmp/towbar-log-drains.XXXXXXXX",
        [],
        { signal, timeoutMs: 10_000 },
      )
    ).stdout.trim();
    if (!/^\/tmp\/towbar-log-drains\.[a-zA-Z0-9]{8}$/.test(staging))
      throw new Error("Unable to stage log configuration");
    for (const [name, content] of Object.entries({
      "vector.json": text,
      "install.sh": logDrainInstallScript,
      "gateway.json": JSON.stringify(gatewayConfiguration),
      "gateway.py": gatewayScript,
    })) {
      const file = path.join(local, name);
      await writeFile(file, content, { mode: 0o600 });
      await session.upload(file, `${staging}/${name}`, {
        signal,
        timeoutMs: 30_000,
      });
    }
    await session.run(
      'sudo -n timeout --signal=TERM 170 bash "$1/install.sh" "$1" "$2" "$3" "$4" "$5" "$6" "$7"',
      [
        staging,
        context.serverId,
        digest,
        credentialDigest,
        logDrainImage,
        logDrainGatewayImage,
        String(Object.keys(configuration?.sinks ?? {}).length * 268435488),
      ],
      { signal, timeoutMs: 150_000 },
    );
    const health = configuration
      ? await readLogDrainHealth(session, context.serverId)
      : [];
    return { digest, active: Boolean(configuration), health };
  } finally {
    if (staging)
      await session
        .run('rm -rf -- "$1"', [staging], { timeoutMs: 10_000 })
        .catch(() => undefined);
    await rm(local, { recursive: true, force: true });
    await session.close();
  }
}
