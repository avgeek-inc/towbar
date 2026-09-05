import { z } from "zod";

import { orphanItemSchema } from "@workspace/towbar-core";

import type { SshSession } from "./ssh.js";
import type {
  RuntimeExpectation,
  RuntimeInspection,
} from "@workspace/towbar-core";

const inspectionSchema = z
  .object({
    orphans: z.array(orphanItemSchema),
    runtime: z.array(
      z
        .object({
          cpuPercent: z.number().nonnegative().nullable(),
          deployableId: z.string().uuid(),
          driftReasons: z.array(z.string()),
          driftStatus: z.enum(["drifted", "in_sync", "unknown"]),
          healthStatus: z.enum([
            "healthy",
            "none",
            "starting",
            "unhealthy",
            "unknown",
          ]),
          memoryLimitBytes: z.number().int().nonnegative().nullable(),
          memoryUsageBytes: z.number().int().nonnegative().nullable(),
          observedContainerName: z.string().nullable(),
          observedImage: z.string().nullable(),
          observedState: z.enum(["missing", "running", "stopped", "unknown"]),
          restartCount: z.number().int().nonnegative().nullable(),
          startedAt: z.string().datetime().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const runtimeInspectionScript = String.raw`
set -euo pipefail
expected_json="$1"
python3 - "$expected_json" <<'PYTHON'
import json
import subprocess
import sys
import urllib.request
import re

expected = json.loads(sys.argv[1])
owned_deployables = set(expected["ownedDeployableIds"])

def owned(labels):
    return labels.get("towbar.managed") == "true" and bool(labels.get("towbar.source")) and labels.get("towbar.deployable") in owned_deployables

def command(*args):
    return subprocess.run(args, check=False, capture_output=True, text=True)

def inspect(kind, name):
    result = command("docker", kind, "inspect", name)
    if result.returncode != 0:
        return None
    value = json.loads(result.stdout)
    return value[0] if value else None

def parse_bytes(value):
    match = re.fullmatch(r"\s*([0-9.]+)\s*([KMGTPE]?i?B)\s*", value or "", re.IGNORECASE)
    if not match:
        return None
    amount = float(match.group(1))
    unit = match.group(2).lower()
    powers = {"b": 0, "kb": 1, "kib": 1, "mb": 2, "mib": 2, "gb": 3, "gib": 3, "tb": 4, "tib": 4, "pb": 5, "pib": 5, "eb": 6, "eib": 6}
    base = 1024 if "i" in unit else 1000
    return int(amount * (base ** powers[unit]))

def collect_runtime_stats():
    container_names = {
        item["release"]["containerName"]
        for item in expected["deployables"]
        if item.get("release")
    }
    if not container_names:
        return {}
    # Query running containers once, then retain only expected release names.
    # Supplying a missing expected name makes Docker fail the whole stats call
    # and would otherwise hide metrics for every healthy container.
    result = command("docker", "stats", "--no-stream", "--format", "{{json .}}")
    if result.returncode != 0:
        return {}
    stats_by_name = {}
    for line in result.stdout.splitlines():
        try:
            stats = json.loads(line)
        except json.JSONDecodeError:
            continue
        name = stats.get("Name") or stats.get("Container")
        if name in container_names:
            stats_by_name[name] = stats
    return stats_by_name

def runtime_metrics(container_name, container, stats_by_name):
    started_at = (container.get("State") or {}).get("StartedAt")
    if not started_at or started_at.startswith("0001-"):
        started_at = None
    stats = stats_by_name.get(container_name)
    if not stats:
        return {
            "cpuPercent": None,
            "memoryLimitBytes": None,
            "memoryUsageBytes": None,
            "restartCount": int(container.get("RestartCount") or 0),
            "startedAt": started_at,
        }
    try:
        memory_usage, _, memory_limit = (stats.get("MemUsage") or "").partition("/")
        return {
            "cpuPercent": float((stats.get("CPUPerc") or "").strip().rstrip("%")),
            "memoryLimitBytes": parse_bytes(memory_limit),
            "memoryUsageBytes": parse_bytes(memory_usage),
            "restartCount": int(container.get("RestartCount") or 0),
            "startedAt": started_at,
        }
    except (KeyError, TypeError, ValueError, json.JSONDecodeError):
        return {
            "cpuPercent": None,
            "memoryLimitBytes": None,
            "memoryUsageBytes": None,
            "restartCount": int(container.get("RestartCount") or 0),
            "startedAt": started_at,
        }

def evaluate_health(item, container, running):
    if not running:
        return "none"
    health = item["health"]
    health_type = health["type"]
    timeout = min(float(health.get("timeoutSeconds", 5)), 5.0)
    if health_type == "command":
        try:
            result = subprocess.run(
                ["docker", "exec", container.get("Name", "").lstrip("/"), *health["command"]],
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout,
            )
            return "healthy" if result.returncode == 0 else "unhealthy"
        except (OSError, subprocess.TimeoutExpired):
            return "unhealthy"
    if health_type == "http":
        connectivity = item.get("connectivity") or {}
        container_port = connectivity.get("containerPort")
        port_key = f"{container_port}/tcp"
        bindings = (container.get("NetworkSettings", {}).get("Ports") or {}).get(port_key) or []
        host_port = next((binding.get("HostPort") for binding in bindings if binding.get("HostPort")), None)
        if not host_port:
            return "unhealthy"
        try:
            with urllib.request.urlopen(
                f'http://127.0.0.1:{host_port}{health["path"]}',
                timeout=timeout,
            ) as response:
                return "healthy" if response.status < 400 else "unhealthy"
        except Exception:
            return "unhealthy"
    health_value = (container.get("State", {}).get("Health") or {}).get("Status")
    return (
        "healthy" if health_value == "healthy" else
        "starting" if health_value == "starting" else
        "unhealthy" if health_value == "unhealthy" else
        "none"
    )

expected_containers = set(expected["containerNames"])
expected_deployables = {item["deployableId"] for item in expected["deployables"]}
expected_images = set(expected["imageTags"])
runtime_stats = collect_runtime_stats()
runtime = []

for item in expected["deployables"]:
    deployable_id = item["deployableId"]
    desired = item["desiredState"]
    release = item.get("release")
    if not release:
        runtime.append({
            "cpuPercent": None,
            "deployableId": deployable_id,
            "driftReasons": [],
            "driftStatus": "unknown",
            "healthStatus": "unknown",
            "memoryLimitBytes": None,
            "memoryUsageBytes": None,
            "observedContainerName": None,
            "observedImage": None,
            "observedState": "unknown",
            "restartCount": None,
            "startedAt": None,
        })
        continue
    container = inspect("container", release["containerName"])
    if not container:
        runtime.append({
            "cpuPercent": None,
            "deployableId": deployable_id,
            "driftReasons": ["Current release container is missing"],
            "driftStatus": "drifted",
            "healthStatus": "unknown",
            "memoryLimitBytes": None,
            "memoryUsageBytes": None,
            "observedContainerName": None,
            "observedImage": None,
            "observedState": "missing",
            "restartCount": None,
            "startedAt": None,
        })
        continue
    labels = container.get("Config", {}).get("Labels") or {}
    running = bool(container.get("State", {}).get("Running"))
    health = evaluate_health(item, container, running)
    image = container.get("Config", {}).get("Image")
    metrics = runtime_metrics(release["containerName"], container, runtime_stats)
    reasons = []
    if image != release["imageTag"]:
        reasons.append("Container image differs from the current release")
    if desired == "running" and not running:
        reasons.append("Container is stopped but Towbar expects it to run")
    if desired == "stopped" and running:
        reasons.append("Container is running but Towbar expects it to be stopped")
    if health == "unhealthy":
        reasons.append("Container health check is failing")
    if labels.get("towbar.source") != item["sourceId"] or labels.get("towbar.deployable") != deployable_id:
        reasons.append("Container predates Source ownership labels; redeploy before cleanup")
    connectivity = item.get("connectivity")
    if connectivity:
        network_name = connectivity.get("network")
        network_alias = connectivity.get("networkAlias")
        if network_name:
            network = (container.get("NetworkSettings", {}).get("Networks") or {}).get(network_name)
            if not network:
                reasons.append("Container is not attached to the configured Docker network")
            elif network_alias and network_alias not in (network.get("Aliases") or []):
                reasons.append("Container is missing its configured Docker network alias")
        host_port = connectivity.get("hostPort")
        if host_port:
            port_key = f'{connectivity["containerPort"]}/tcp'
            bindings = (container.get("NetworkSettings", {}).get("Ports") or {}).get(port_key) or []
            if not any(
                binding.get("HostIp") == "127.0.0.1"
                and binding.get("HostPort") == str(host_port)
                for binding in bindings
            ):
                reasons.append("Container is missing its configured loopback host port")
    runtime.append({
        **metrics,
        "deployableId": deployable_id,
        "driftReasons": reasons,
        "driftStatus": "drifted" if reasons else "in_sync",
        "healthStatus": health if running else "none",
        "observedContainerName": container.get("Name", "").lstrip("/") or None,
        "observedImage": image,
        "observedState": "running" if running else "stopped",
    })

orphans = []
containers = command("docker", "ps", "-aq", "--filter", "label=towbar.managed=true")
for name in containers.stdout.splitlines():
    container = inspect("container", name)
    if not container:
        continue
    labels = container.get("Config", {}).get("Labels") or {}
    container_name = container.get("Name", "").lstrip("/")
    if owned(labels) and container_name not in expected_containers:
        orphans.append({
            "kind": "container",
            "name": container_name,
            "reason": "Towbar container is not a current release",
        })

volumes = command("docker", "volume", "ls", "-q", "--filter", "label=towbar.managed=true")
for name in volumes.stdout.splitlines():
    volume = inspect("volume", name)
    if not volume:
        continue
    labels = volume.get("Labels") or {}
    if owned(labels) and labels.get("towbar.deployable") not in expected_deployables:
        orphans.append({
            "kind": "volume",
            "name": name,
            "reason": "Persistent volume belongs to a removed deployable",
        })

images = command("docker", "image", "ls", "--format", "{{.Repository}}:{{.Tag}}")
for name in images.stdout.splitlines():
    if not name.startswith("towbar/") or name.endswith(":<none>"):
        continue
    image = inspect("image", name)
    if not image:
        continue
    labels = (image.get("Config") or {}).get("Labels") or {}
    if owned(labels) and name not in expected_images:
        orphans.append({
            "kind": "image",
            "name": name,
            "reason": "Towbar image is not retained by a current or previous release",
        })

orphans.sort(key=lambda item: (item["kind"], item["name"]))
print(json.dumps({"orphans": orphans, "runtime": runtime}, separators=(",", ":")))
PYTHON
`;

export async function inspectServerRuntime(input: {
  containerNames: string[];
  deployables: RuntimeExpectation[];
  imageTags: string[];
  ownedDeployableIds?: string[];
  session: SshSession;
}) {
  const { stdout } = await input.session.run(
    runtimeInspectionScript,
    [
      JSON.stringify({
        containerNames: input.containerNames,
        deployables: input.deployables,
        imageTags: input.imageTags,
        ownedDeployableIds:
          input.ownedDeployableIds ??
          input.deployables.map((item) => item.deployableId),
      }),
    ],
    { timeoutMs: 60_000 },
  );
  return parseRuntimeInspectionOutput(stdout);
}

export function parseRuntimeInspectionOutput(value: string) {
  return inspectionSchema.parse(JSON.parse(value)) as {
    orphans: z.infer<typeof orphanItemSchema>[];
    runtime: RuntimeInspection[];
  };
}
