import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  instanceMetadataPython,
  parseInstanceMetadata,
} from "./instance-metadata.js";

function detect(responses: Record<string, string>, delay = 0) {
  const prelude = `
import io, json, urllib.request, time
delay = ${delay}
responses = json.loads(${JSON.stringify(JSON.stringify(responses))})
class FakeOpener:
    def open(self, req, timeout):
        assert timeout == 0.75
        assert req.full_url.startswith(("http://169.254.169.254/", "http://100.100.100.200/"))
        assert not any(key in req.full_url for key in ("user-data", "user_data", "credentials", "ssh-keys", "identity/cert"))
        if delay:
            time.sleep(delay)
        if req.full_url.startswith("http://100.100.100.200/"):
            if req.method == "PUT":
                assert req.get_header("X-aliyun-ecs-metadata-token-ttl-seconds") == "60"
            else:
                assert req.get_header("X-aliyun-ecs-metadata-token") == "aliyun-token"
        elif req.full_url.endswith("/latest/api/token"):
            assert req.method == "PUT"
            assert req.get_header("X-aws-ec2-metadata-token-ttl-seconds") == "60"
        elif req.full_url.endswith("/latest/meta-data/instance-type"):
            assert req.get_header("X-aws-ec2-metadata-token") == "test-token"
        elif "/computeMetadata/" in req.full_url:
            assert req.get_header("Metadata-flavor") == "Google"
        elif "/metadata/instance/" in req.full_url:
            assert req.get_header("Metadata") == "true"
        elif "/opc/v2/" in req.full_url:
            assert req.get_header("Authorization") == "Bearer Oracle"
        elif req.selector == "/v1/token":
            assert req.method == "PUT"
            assert req.get_header("Metadata-token-expiry-seconds") == "60"
        elif req.selector == "/v1/instance":
            assert req.get_header("Metadata-token") == "linode-token"
            assert req.get_header("Accept") == "application/json"
        key = req.full_url if req.full_url.startswith("http://100.100.100.200/") else req.selector
        if key not in responses:
            raise TimeoutError("Metadata unavailable")
        return io.BytesIO(responses[key].encode())
def build_opener(*handlers):
    assert any(isinstance(h, urllib.request.ProxyHandler) and h.proxies == {} for h in handlers)
    assert any(isinstance(h, NoRedirect) for h in handlers)
    return FakeOpener()
urllib.request.build_opener = build_opener
`;
  const result = spawnSync(
    "python3",
    ["-c", prelude + instanceMetadataPython],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return parseInstanceMetadata(result.stdout);
}
void test("detects AWS using IMDSv2", () => {
  assert.deepEqual(
    detect({
      "/latest/api/token": "test-token",
      "/latest/meta-data/instance-type": "r6a.xlarge",
    }),
    { provider: "aws", type: "r6a.xlarge" },
  );
});
void test("normalizes GCP machine type paths", () => {
  assert.deepEqual(
    detect({
      "/computeMetadata/v1/instance/machine-type":
        "projects/123/machineTypes/n2-standard-8",
    }),
    { provider: "gcp", type: "n2-standard-8" },
  );
});
void test("reads Azure vmSize", () => {
  assert.deepEqual(
    detect({
      "/metadata/instance/compute/vmSize?api-version=2021-02-01&format=text":
        "Standard_D8s_v5",
    }),
    { provider: "azure", type: "Standard_D8s_v5" },
  );
});
void test("unavailable, oversized, and malformed metadata falls back without failure", () => {
  assert.equal(detect({}), null);
  assert.equal(
    detect({
      "/latest/api/token": "test-token",
      "/latest/meta-data/instance-type": "x".repeat(1025),
    }),
    null,
  );
  assert.equal(
    detect({
      "/computeMetadata/v1/instance/machine-type": "<html>not metadata</html>",
    }),
    null,
  );
  assert.equal(parseInstanceMetadata("not json"), null);
});

void test("reads Oracle shapes using IMDSv2, including flexible shapes", () => {
  assert.deepEqual(
    detect({ "/opc/v2/instance/shape": "VM.Standard.A1.Flex" }),
    { provider: "oracle", type: "VM.Standard.A1.Flex" },
  );
});
void test("recognizes Hetzner and DigitalOcean without inventing a plan", () => {
  assert.deepEqual(detect({ "/hetzner/v1/metadata/instance-id": "123456" }), {
    provider: "hetzner",
    type: null,
  });
  assert.deepEqual(detect({ "/metadata/v1/id": "789012" }), {
    provider: "digitalocean",
    type: null,
  });
  assert.equal(
    detect({ "/hetzner/v1/metadata/instance-id": "<html>123456</html>" }),
    null,
  );
});
void test("reads Linode type from token-authenticated instance properties", () => {
  assert.deepEqual(
    detect({
      "/v1/token": "linode-token",
      "/v1/instance": JSON.stringify({
        id: 532754976,
        type: "g6-standard-1",
        label: "ignored",
        specs: { vcpus: 1 },
      }),
    }),
    { provider: "linode", type: "g6-standard-1" },
  );
  assert.equal(
    detect({ "/v1/token": "linode-token", "/v1/instance": "[]" }),
    null,
  );
  assert.equal(
    detect({ "/v1/token": "linode-token", "/v1/instance": "x".repeat(16385) }),
    null,
  );
});
void test("reads Alibaba ECS using security hardening mode", () => {
  assert.deepEqual(
    detect({
      "http://100.100.100.200/latest/api/token": "aliyun-token",
      "http://100.100.100.200/latest/meta-data/instance/instance-type":
        "ecs.g6e.large",
    }),
    { provider: "alibaba", type: "ecs.g6e.large" },
  );
});
void test("conflicting provider responses do not mislabel a server", () => {
  assert.equal(
    detect({
      "/hetzner/v1/metadata/instance-id": "123",
      "/metadata/v1/id": "456",
    }),
    null,
  );
});
void test("a hung provider cannot exceed the overall detection deadline", () => {
  const start = performance.now();
  assert.equal(detect({}, 10), null);
  assert(performance.now() - start < 4500);
});
