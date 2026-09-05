import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import {
  instanceMetadataPython,
  parseInstanceMetadata,
} from "./instance-metadata.js";

function detect(responses: Record<string, string>) {
  const prelude = `
import io, json, urllib.request
responses = json.loads(${JSON.stringify(JSON.stringify(responses))})
class FakeOpener:
    def open(self, req, timeout):
        assert timeout == 0.75
        assert req.full_url.startswith("http://169.254.169.254/")
        if req.full_url.endswith("/latest/api/token"):
            assert req.method == "PUT"
            assert req.get_header("X-aws-ec2-metadata-token-ttl-seconds") == "60"
        elif req.full_url.endswith("/latest/meta-data/instance-type"):
            assert req.get_header("X-aws-ec2-metadata-token") == "test-token"
        elif "/computeMetadata/" in req.full_url:
            assert req.get_header("Metadata-flavor") == "Google"
        elif "/metadata/instance/" in req.full_url:
            assert req.get_header("Metadata") == "true"
        if req.selector not in responses:
            raise TimeoutError("Metadata unavailable")
        return io.BytesIO(responses[req.selector].encode())
def build_opener(*handlers):
    assert any(isinstance(h, urllib.request.ProxyHandler) and h.proxies == {} for h in handlers)
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
