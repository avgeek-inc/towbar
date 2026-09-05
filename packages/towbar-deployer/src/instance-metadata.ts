import {
  type CloudInstance,
  cloudInstanceSchema,
} from "@workspace/towbar-core";

// Requests run on the managed host, bypass proxies, and fetch only machine size.
// AWS IMDSv2: https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/configuring-instance-metadata-service.html
// GCP: https://cloud.google.com/compute/docs/metadata/predefined-metadata-keys
// Azure: https://learn.microsoft.com/azure/virtual-machines/instance-metadata-service
export const instanceMetadataPython = String.raw`
import json, re, urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
base = "http://169.254.169.254"
def request(path, headers=None, method="GET"):
    try:
        req = urllib.request.Request(base + path, headers=headers or {}, method=method)
        with opener.open(req, timeout=0.75) as response:
            value = response.read(1025)
            if len(value) > 1024:
                return ""
            return value.decode("utf-8").strip()
    except Exception:
        return ""

def detect():
    token = request("/latest/api/token", {"X-aws-ec2-metadata-token-ttl-seconds": "60"}, "PUT")
    if token:
        value = request("/latest/meta-data/instance-type", {"X-aws-ec2-metadata-token": token})
        if re.fullmatch(r"[a-z][a-z0-9-]*\.[a-z0-9]+", value):
            return {"provider": "aws", "type": value}
    value = request("/computeMetadata/v1/instance/machine-type", {"Metadata-Flavor": "Google"})
    match = re.fullmatch(r"projects/[^/]+/machineTypes/([a-zA-Z0-9_-]+)", value)
    if match:
        return {"provider": "gcp", "type": match.group(1)}
    value = request("/metadata/instance/compute/vmSize?api-version=2021-02-01&format=text", {"Metadata": "true"})
    if re.fullmatch(r"(?:Standard|Basic)_[a-zA-Z0-9_-]+", value):
        return {"provider": "azure", "type": value}
    return None

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
