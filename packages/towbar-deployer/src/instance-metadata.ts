import {
  type CloudInstance,
  cloudInstanceSchema,
} from "@workspace/towbar-core";

// Fixed provider endpoints only; no proxy, redirects, user-data, credentials,
// or cloud account tokens. See packages/towbar-deployer/CLOUD_METADATA.md.
export const instanceMetadataPython = String.raw`
import json, queue, re, threading, time, urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

base = "http://169.254.169.254"
aliyun = "http://100.100.100.200"
def request(path, headers=None, method="GET", origin=base, limit=1024):
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        req = urllib.request.Request(origin + path, headers=headers or {}, method=method)
        with opener.open(req, timeout=0.75) as response:
            value = response.read(limit + 1)
            if len(value) > limit:
                return ""
            return value.decode("utf-8").strip()
    except Exception:
        return ""

def typed(provider, value, pattern):
    if isinstance(value, str) and len(value) <= 128 and re.fullmatch(pattern, value):
        return {"provider": provider, "type": value}
    return None

def aws():
    token = request("/latest/api/token", {"X-aws-ec2-metadata-token-ttl-seconds": "60"}, "PUT")
    if token:
        return typed("aws", request("/latest/meta-data/instance-type", {"X-aws-ec2-metadata-token": token}), r"[a-z][a-z0-9-]*\.[a-z0-9]+")

def gcp():
    value = request("/computeMetadata/v1/instance/machine-type", {"Metadata-Flavor": "Google"})
    match = re.fullmatch(r"projects/[^/]+/machineTypes/([a-zA-Z0-9_-]+)", value)
    if match:
        return typed("gcp", match.group(1), r"[a-zA-Z0-9_-]+")

def azure():
    value = request("/metadata/instance/compute/vmSize?api-version=2021-02-01&format=text", {"Metadata": "true"})
    return typed("azure", value, r"(?:Standard|Basic)_[a-zA-Z0-9_-]+")

def oracle():
    value = request("/opc/v2/instance/shape", {"Authorization": "Bearer Oracle"})
    return typed("oracle", value, r"(?:VM|BM)\.[a-zA-Z0-9._-]+")

def hetzner():
    value = request("/hetzner/v1/metadata/instance-id")
    if re.fullmatch(r"[1-9][0-9]{0,19}", value):
        return {"provider": "hetzner", "type": None}

def digitalocean():
    value = request("/metadata/v1/id")
    if re.fullmatch(r"[1-9][0-9]{0,19}", value):
        return {"provider": "digitalocean", "type": None}

def linode():
    token = request("/v1/token", {"Metadata-Token-Expiry-Seconds": "60"}, "PUT")
    if not token:
        return None
    # This endpoint contains instance properties only; user-data and SSH keys
    # have separate endpoints which we never request. Discard every other field.
    value = json.loads(request("/v1/instance", {"Metadata-Token": token, "Accept": "application/json"}, limit=16384))
    if isinstance(value, dict) and type(value.get("id")) is int and value["id"] > 0:
        return typed("linode", value.get("type"), r"[a-zA-Z0-9][a-zA-Z0-9._-]+")

def alibaba():
    token = request("/latest/api/token", {"X-aliyun-ecs-metadata-token-ttl-seconds": "60"}, "PUT", origin=aliyun)
    if token:
        value = request("/latest/meta-data/instance/instance-type", {"X-aliyun-ecs-metadata-token": token}, origin=aliyun)
        return typed("alibaba", value, r"ecs\.[a-zA-Z0-9._-]+")

def detect():
    probes = [aws, gcp, azure, oracle, hetzner, digitalocean, linode, alibaba]
    results = queue.Queue()
    def probe(detector):
        try:
            result = detector()
        except Exception:
            result = None
        results.put(result)
    # Daemon workers and a wall-clock deadline also bound slow/trickling bodies.
    # Never let eight absent providers consume the SSH check's five-second budget.
    deadline = time.monotonic() + 2.5
    for detector in probes:
        threading.Thread(target=probe, args=(detector,), daemon=True).start()
    matches = []
    for _ in probes:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        try:
            result = results.get(timeout=remaining)
        except queue.Empty:
            break
        if result:
            matches.append(result)
    # Conflicting provider-specific responses are not a trustworthy identity.
    return matches[0] if len(matches) == 1 else None

print(json.dumps(detect()))
`;

export const instanceMetadataScript = `python3 - <<'TOWBAR_INSTANCE_METADATA'\n${instanceMetadataPython}\nTOWBAR_INSTANCE_METADATA`;

export function parseInstanceMetadata(output: string): CloudInstance | null {
  try {
    const result = cloudInstanceSchema.safeParse(JSON.parse(output));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
