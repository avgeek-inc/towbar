import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  NormalizedServer,
  ProviderConnection,
} from "@workspace/towbar-core";
import { SshSession } from "./ssh.js";
import type { SshLoginSecret, TrustedHostKey } from "./types.js";

const collectorImage =
  "otel/opentelemetry-collector-contrib:0.161.0@sha256:fd328de2552466ad78385e1b1289c3f2402b1c45f265b252aab1955b42845ac1";
const exporterQueueSize = 1_000;
type OtlpConnection = Extract<ProviderConnection, { provider: "otlp" }>;
export type OtlpCollectorContext = {
  serverId: string;
  config: NormalizedServer;
  login: SshLoginSecret;
  trustedHostKeys: TrustedHostKey[];
  connection: OtlpConnection | null;
  connectionSlug: string | null;
  networks: string[];
  signals: Array<"logs" | "metrics" | "traces">;
  sampling: number;
  redactAttributes: string[];
  cardinalityLimit: number;
};

export type OtlpCollectorMetrics = {
  enqueueFailures: Record<"logs" | "metrics" | "traces", number>;
  queueCapacity: number;
  queueDepth: number;
  sendFailures: Record<"logs" | "metrics" | "traces", number>;
};

export function buildOtlpCollectorConfiguration(context: OtlpCollectorContext) {
  if (!context.connection) return "";
  const { configuration, credentials } = context.connection;
  const exporterPrefix =
    configuration.protocol === "grpc" ? "otlp" : "otlphttp";
  const signals = [...new Set(context.signals)];
  const exporterName = (signal: "logs" | "metrics" | "traces") =>
    `${exporterPrefix}/upstream_${signal}`;
  const processors: Record<string, unknown> = {
    memory_limiter: {
      check_interval: "1s",
      limit_mib: 192,
      spike_limit_mib: 48,
    },
    batch: { timeout: "5s", send_batch_size: 512, send_batch_max_size: 1_024 },
  };
  if (signals.includes("metrics"))
    processors.cardinality_guardian = {
      max_cardinality_delta_per_epoch: context.cardinalityLimit,
      epoch_duration_seconds: 300,
      enforcement_mode: "overflow_attribute",
      never_drop_labels: [
        "deployment.environment.name",
        "service.name",
        "towbar.app.id",
        "towbar.compose.service",
        "towbar.repository.id",
        "towbar.server.id",
        "towbar.team.id",
      ],
      top_offenders_count: 10,
      max_tracker_count: Math.min(
        20_000,
        Math.max(1_000, context.cardinalityLimit * 2),
      ),
      drop_log_max_per_epoch: 10,
    };
  if (context.redactAttributes.length)
    processors.attributes = {
      actions: context.redactAttributes.map((key) => ({
        key,
        action: "delete",
      })),
    };
  if (context.sampling < 1)
    processors.probabilistic_sampler = {
      sampling_percentage: Math.max(0, Math.min(100, context.sampling * 100)),
    };
  const commonProcessors = [
    "memory_limiter",
    ...(context.redactAttributes.length ? ["attributes"] : []),
    "batch",
  ];
  const exporterConfiguration = {
    endpoint: configuration.endpoint,
    headers: credentials.headers,
    sending_queue: {
      block_on_overflow: false,
      enabled: true,
      num_consumers: 2,
      queue_size: exporterQueueSize,
      sizer: "items",
      storage: "file_storage/queue",
    },
    retry_on_failure: {
      enabled: true,
      initial_interval: "5s",
      max_interval: "30s",
      max_elapsed_time: "10m",
    },
    compression: "gzip",
    timeout: "30s",
  };
  const pipelines = Object.fromEntries(
    signals.map((signal) => [
      signal,
      {
        receivers: ["otlp"],
        processors:
          signal === "traces" && context.sampling < 1
            ? [
                "memory_limiter",
                "probabilistic_sampler",
                ...(context.redactAttributes.length ? ["attributes"] : []),
                "batch",
              ]
            : signal === "metrics"
              ? [
                  "memory_limiter",
                  "cardinality_guardian",
                  ...(context.redactAttributes.length ? ["attributes"] : []),
                  "batch",
                ]
              : commonProcessors,
        exporters: [exporterName(signal)],
      },
    ]),
  );
  return `${JSON.stringify(
    {
      receivers: {
        otlp: {
          protocols: {
            grpc: { endpoint: "0.0.0.0:4317" },
            http: { endpoint: "0.0.0.0:4318" },
          },
        },
      },
      processors,
      exporters: Object.fromEntries(
        signals.map((signal) => [exporterName(signal), exporterConfiguration]),
      ),
      extensions: {
        "file_storage/queue": {
          create_directory: true,
          directory: "/var/lib/otelcol/queue",
          timeout: "10s",
          compaction: { on_start: true, directory: "/var/lib/otelcol/compact" },
        },
      },
      service: {
        extensions: ["file_storage/queue"],
        telemetry: {
          logs: { level: "info" },
          metrics: {
            level: "detailed",
            readers: [
              {
                pull: {
                  exporter: {
                    prometheus: {
                      host: "127.0.0.1",
                      port: 8888,
                      without_type_suffix: true,
                      without_units: true,
                    },
                  },
                },
              },
            ],
          },
        },
        pipelines,
      },
    },
    null,
    2,
  )}\n`;
}

const collectMetricsScript = String.raw`set -euo pipefail
name="$1"
pid="$(sudo -n docker inspect -f '{{.State.Pid}}' "$name")"
case "$pid" in ''|*[!0-9]*) exit 1;; esac
sudo -n timeout 12 nsenter --target "$pid" --net -- python3 - <<'PYTHON'
import json, re, time, urllib.request

url = "http://127.0.0.1:8888/metrics"
payload = None
for _ in range(20):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(url, timeout=1) as response:
            payload = response.read(2_000_000).decode("utf-8", "replace")
        break
    except Exception:
        time.sleep(0.25)
if payload is None:
    raise SystemExit("Collector metrics are not ready")

signals = ("logs", "metrics", "traces")
result = {
    "queueDepth": 0,
    "queueCapacity": 0,
    "enqueueFailures": {signal: 0 for signal in signals},
    "sendFailures": {signal: 0 for signal in signals},
}
observed = False
line_pattern = re.compile(r"^([A-Za-z_:][A-Za-z0-9_:]*)(?:\{([^}]*)\})?\s+([-+0-9.eE]+)(?:\s|$)")
label_pattern = re.compile(r'(?:^|,)\s*([A-Za-z_][A-Za-z0-9_.]*)="((?:\\.|[^"\\])*)"')
for line in payload.splitlines():
    if line.startswith("#"):
        continue
    match = line_pattern.match(line)
    if not match:
        continue
    metric = match.group(1)
    if metric.endswith("_total"):
        metric = metric[:-6]
    accepted = {
        "otelcol_exporter_queue_size",
        "otelcol_exporter_queue_capacity",
        "otelcol_exporter_enqueue_failed_log_records",
        "otelcol_exporter_enqueue_failed_metric_points",
        "otelcol_exporter_enqueue_failed_spans",
        "otelcol_exporter_send_failed_log_records",
        "otelcol_exporter_send_failed_metric_points",
        "otelcol_exporter_send_failed_spans",
    }
    if metric not in accepted:
        continue
    labels = dict(label_pattern.findall(match.group(2) or ""))
    exporter = labels.get("exporter") or labels.get("otelcol_component_id") or ""
    if "upstream_" not in exporter:
        continue
    try:
        value = max(0, int(float(match.group(3))))
    except ValueError:
        continue
    observed = True
    if metric == "otelcol_exporter_queue_size":
        result["queueDepth"] += value
    elif metric == "otelcol_exporter_queue_capacity":
        result["queueCapacity"] += value
    else:
        signal = "logs" if metric.endswith("log_records") else "metrics" if metric.endswith("metric_points") else "traces"
        target = "enqueueFailures" if "enqueue_failed" in metric else "sendFailures"
        result[target][signal] += value
if not observed:
    raise SystemExit("Collector queue metrics are unavailable")
print(json.dumps(result, separators=(",", ":")))
PYTHON
`;

const installScript = String.raw`set -euo pipefail
stage="$1"
server="$2"
digest="$3"
image="$4"
networks_json="$5"
destination="$6"
allow_private="$7"
credential_digest="$8"
base="/var/lib/towbar/otel/$server"
name="towbar-otel-$server"
install -d -m 0700 "$base" "$base/state"
exec 9>"$base/lock"
flock -w 30 9
trap 'rm -rf -- "$stage" "$base/candidate"' EXIT
if test ! -s "$stage/collector.json"; then
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf -- "$base/config" "$base/state" "$base/digest"
  rm -f "$base/image" "$base/networks" "$base/host" "$base/ip" "$base/credentials"
  exit 0
fi
mapfile -t networks < <(python3 -c 'import json,sys; print("\n".join(json.loads(sys.argv[1])))' "$networks_json")
test "${"$"}{#networks[@]}" -gt 0
for network in "${"$"}{networks[@]}"; do docker network inspect "$network" >/dev/null; done
if test "$(cat "$base/digest" 2>/dev/null || true)" = "$digest" && test "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" = true; then exit 0; fi
available=$(df -PB1 "$base" | awk 'NR==2 {print $4}')
test "$available" -ge 1073741824
docker image inspect "$image" >/dev/null 2>&1 || docker pull "$image" >/dev/null
read -r destination_ip pin_destination < <(python3 - "$destination" "$allow_private" <<'PYTHON'
import ipaddress, socket, sys, urllib.parse
url, allow_private = urllib.parse.urlsplit(sys.argv[1]), sys.argv[2] == "true"
host = url.hostname
if not host or host.rstrip(".").lower() in {"localhost", "metadata.google.internal"}:
    raise SystemExit("OTLP destination is not allowed")
try:
    addresses = {entry[4][0] for entry in socket.getaddrinfo(host, url.port or 443)}
except socket.gaierror as error:
    raise SystemExit("OTLP destination could not be resolved") from error
private_networks = [ipaddress.ip_network(value) for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")]
if not addresses:
    raise SystemExit("OTLP destination could not be resolved")
for raw in addresses:
    address = ipaddress.ip_address(raw)
    if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified:
        raise SystemExit("OTLP destination is not allowed")
    private = any(address in network for network in private_networks)
    if private:
        if not allow_private:
            raise SystemExit("Private OTLP destinations require explicit approval")
    elif not address.is_global:
        raise SystemExit("OTLP destination is not allowed")
ordered = sorted((ipaddress.ip_address(raw) for raw in addresses), key=lambda item: (item.version, int(item)))
literal = True
try:
    ipaddress.ip_address(host)
except ValueError:
    literal = False
print(str(ordered[0]), "false" if literal else "true")
PYTHON
)
destination_host="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.urlsplit(sys.argv[1]).hostname)' "$destination")"
install -d -m 0700 "$base/candidate"
install -m 0600 "$stage/collector.json" "$base/candidate/collector.json"
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 0.5 --pids-limit 96 --mount "type=bind,src=$base/candidate,dst=/etc/otelcol-contrib,readonly" --mount "type=bind,src=$base/state,dst=/var/lib/otelcol" "$image" validate --config=/etc/otelcol-contrib/collector.json >/dev/null
rm -rf -- "$base/previous" "$base/previous-state"
previous_image="$(cat "$base/image" 2>/dev/null || printf '%s' "$image")"
previous_networks="$(cat "$base/networks" 2>/dev/null || printf '%s' "$networks_json")"
previous_host="$(cat "$base/host" 2>/dev/null || printf '%s' "$destination_host")"
previous_ip="$(cat "$base/ip" 2>/dev/null || printf '%s' "$destination_ip")"
had_previous=false
state_moved=false
if test -d "$base/config"; then mv "$base/config" "$base/previous"; had_previous=true; fi
if test "$(cat "$base/credentials" 2>/dev/null || true)" != "$credential_digest" && test -d "$base/state"; then
  mv "$base/state" "$base/previous-state"
  state_moved=true
fi
install -d -m 0700 "$base/state"
mv "$base/candidate" "$base/config"
docker rm -f "$name" >/dev/null 2>&1 || true
run_collector() {
  local run_image="$1" run_networks="$2" run_host="$3" run_ip="$4"
  local -a selected_networks host_args
  mapfile -t selected_networks < <(python3 -c 'import json,sys; print("\n".join(json.loads(sys.argv[1])))' "$run_networks")
  test "${"$"}{#selected_networks[@]}" -gt 0 || return 1
  host_args=()
  if test -n "$run_host" && test -n "$run_ip" && test "$run_host" != "$run_ip"; then host_args=(--add-host "$run_host=$run_ip"); fi
  docker run -d --name "$name" --network "${"$"}{selected_networks[0]}" --network-alias towbar-otel "${"$"}{host_args[@]}" --label towbar.managed=true --label towbar.telemetry=otel --restart unless-stopped --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 0.5 --pids-limit 96 --log-driver local --log-opt max-size=2m --log-opt max-file=2 --mount "type=bind,src=$base/config,dst=/etc/otelcol-contrib,readonly" --mount "type=bind,src=$base/state,dst=/var/lib/otelcol" "$run_image" --config=/etc/otelcol-contrib/collector.json >/dev/null || return 1
  for network in "${"$"}{selected_networks[@]:1}"; do
    if ! docker network connect --alias towbar-otel "$network" "$name"; then docker rm -f "$name" >/dev/null 2>&1 || true; return 1; fi
  done
}
restore_previous() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf -- "$base/config"
  if test "$state_moved" = true; then rm -rf -- "$base/state"; mv "$base/previous-state" "$base/state"; fi
  if test "$had_previous" = true; then
    mv "$base/previous" "$base/config"
    run_collector "$previous_image" "$previous_networks" "$previous_host" "$previous_ip" || true
  fi
}
if ! run_collector "$image" "$networks_json" "$destination_host" "$destination_ip"; then restore_previous; exit 1; fi
ready=false
stable=0
for attempt in $(seq 1 20); do
  if test "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" = true; then
    stable=$((stable + 1))
    if test "$stable" -ge 3; then ready=true; break; fi
  else
    stable=0
  fi
  sleep 1
done
if test "$ready" != true; then restore_previous; exit 1; fi
printf '%s' "$digest" > "$base/digest"
printf '%s' "$image" > "$base/image"
printf '%s' "$networks_json" > "$base/networks"
printf '%s' "$destination_host" > "$base/host"
printf '%s' "$destination_ip" > "$base/ip"
printf '%s' "$credential_digest" > "$base/credentials"
chmod 0600 "$base/digest" "$base/image" "$base/networks" "$base/host" "$base/ip" "$base/credentials"
rm -rf -- "$base/previous" "$base/previous-state"
`;

export async function reconcileOtlpCollector(
  context: OtlpCollectorContext,
  signal?: AbortSignal,
) {
  const configuration = buildOtlpCollectorConfiguration(context);
  const digest = createHash("sha256")
    .update(configuration)
    .update(JSON.stringify([...new Set(context.networks)].sort()))
    .digest("hex");
  const credentialDigest = createHash("sha256")
    .update(
      JSON.stringify(
        context.connection
          ? {
              endpoint: context.connection.configuration.endpoint,
              protocol: context.connection.configuration.protocol,
              credentials: context.connection.credentials,
            }
          : null,
      ),
    )
    .digest("hex");
  const session = await SshSession.connect({
    server: context.config,
    login: context.login,
    trustedHostKeys: context.trustedHostKeys,
  });
  const local = await mkdtemp(path.join(tmpdir(), "towbar-otel-"));
  let stage = "";
  try {
    stage = (
      await session.run("umask 077; mktemp -d /tmp/towbar-otel.XXXXXXXX", [], {
        signal,
        timeoutMs: 10_000,
      })
    ).stdout.trim();
    if (!/^\/tmp\/towbar-otel\.[A-Za-z0-9]{8}$/u.test(stage))
      throw new Error("Unable to stage OTLP collector configuration");
    for (const [name, content] of Object.entries({
      "collector.json": configuration,
      "install.sh": installScript,
    })) {
      const file = path.join(local, name);
      await writeFile(file, content, { mode: 0o600 });
      await session.upload(file, `${stage}/${name}`, {
        signal,
        timeoutMs: 30_000,
      });
    }
    await session.run(
      'sudo -n timeout --signal=TERM 170 bash "$1/install.sh" "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"',
      [
        stage,
        context.serverId,
        digest,
        collectorImage,
        JSON.stringify([...new Set(context.networks)].sort()),
        context.connection?.configuration.endpoint ??
          "https://disabled.invalid",
        String(context.connection?.configuration.allowPrivateNetwork ?? false),
        credentialDigest,
      ],
      { signal, timeoutMs: 180_000 },
    );
    const metrics = context.connection
      ? await session
          .run(collectMetricsScript, [`towbar-otel-${context.serverId}`], {
            signal,
            timeoutMs: 15_000,
          })
          .then((output) => JSON.parse(output.stdout) as OtlpCollectorMetrics)
          .catch(() => null)
      : null;
    return {
      active: Boolean(context.connection),
      digest,
      persistentQueue: Boolean(context.connection),
      queueSize: context.connection
        ? exporterQueueSize * new Set(context.signals).size
        : 0,
      signals: context.connection ? [...new Set(context.signals)] : [],
      slug: context.connectionSlug,
      metrics,
    };
  } finally {
    if (stage)
      await session
        .run('rm -rf -- "$1"', [stage], { timeoutMs: 10_000 })
        .catch(() => undefined);
    await rm(local, { recursive: true, force: true });
    await session.close();
  }
}
