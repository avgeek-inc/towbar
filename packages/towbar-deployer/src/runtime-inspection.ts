import { z } from "zod";

import { orphanItemSchema } from "@workspace/towbar-core";

import type { SshSession } from "./ssh.js";
import type {
  RuntimeDesiredState,
  RuntimeInspection,
} from "@workspace/towbar-core";

const inspectionSchema = z
  .object({
    orphans: z.array(orphanItemSchema),
    runtime: z.array(
      z
        .object({
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
          observedContainerName: z.string().nullable(),
          observedImage: z.string().nullable(),
          observedState: z.enum(["missing", "running", "stopped", "unknown"]),
        })
        .strict(),
    ),
  })
  .strict();

export const runtimeInspectionScript = String.raw`
set -euo pipefail
source_id="$1"
expected_json="$2"
python3 - "$source_id" "$expected_json" <<'PYTHON'
import json
import subprocess
import sys

source_id = sys.argv[1]
expected = json.loads(sys.argv[2])

def command(*args):
    return subprocess.run(args, check=False, capture_output=True, text=True)

def inspect(kind, name):
    result = command("docker", kind, "inspect", name)
    if result.returncode != 0:
        return None
    value = json.loads(result.stdout)
    return value[0] if value else None

expected_containers = {
    item["release"]["containerName"]
    for item in expected["deployables"]
    if item.get("release")
}
expected_deployables = {item["deployableId"] for item in expected["deployables"]}
expected_images = set(expected["imageTags"])
runtime = []

for item in expected["deployables"]:
    deployable_id = item["deployableId"]
    desired = item["desiredState"]
    release = item.get("release")
    if not release:
        runtime.append({
            "deployableId": deployable_id,
            "driftReasons": [],
            "driftStatus": "unknown",
            "healthStatus": "unknown",
            "observedContainerName": None,
            "observedImage": None,
            "observedState": "unknown",
        })
        continue
    container = inspect("container", release["containerName"])
    if not container:
        runtime.append({
            "deployableId": deployable_id,
            "driftReasons": ["Current release container is missing"],
            "driftStatus": "drifted",
            "healthStatus": "unknown",
            "observedContainerName": None,
            "observedImage": None,
            "observedState": "missing",
        })
        continue
    labels = container.get("Config", {}).get("Labels") or {}
    running = bool(container.get("State", {}).get("Running"))
    health_value = (container.get("State", {}).get("Health") or {}).get("Status")
    health = (
        "healthy" if health_value == "healthy" else
        "starting" if health_value == "starting" else
        "unhealthy" if health_value == "unhealthy" else
        "none"
    )
    image = container.get("Config", {}).get("Image")
    reasons = []
    if image != release["imageTag"]:
        reasons.append("Container image differs from the current release")
    if desired == "running" and not running:
        reasons.append("Container is stopped but Towbar expects it to run")
    if desired == "stopped" and running:
        reasons.append("Container is running but Towbar expects it to be stopped")
    if health == "unhealthy":
        reasons.append("Container health check is failing")
    if labels.get("towbar.source") != source_id or labels.get("towbar.deployable") != deployable_id:
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
    if labels.get("towbar.source") == source_id and container_name not in expected_containers:
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
    if labels.get("towbar.source") == source_id and labels.get("towbar.deployable") not in expected_deployables:
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
    if labels.get("towbar.source") == source_id and name not in expected_images:
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
  deployables: Array<{
    connectivity: {
      containerPort: number;
      hostPort: number | null;
      network: string | null;
      networkAlias: string | null;
    } | null;
    deployableId: string;
    desiredState: RuntimeDesiredState;
    release: { containerName: string; imageTag: string } | null;
  }>;
  imageTags: string[];
  session: SshSession;
  sourceId: string;
}) {
  const { stdout } = await input.session.run(
    runtimeInspectionScript,
    [
      input.sourceId,
      JSON.stringify({
        deployables: input.deployables,
        imageTags: input.imageTags,
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
