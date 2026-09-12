import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  parseTrivyScanResult,
  trivyScanScript,
} from "../../apps/towbar-worker/dist/vulnerability-scanners/trivy.js";
import { startTestTarget } from "./target.mjs";

const target = await startTestTarget();
try {
  assert.notEqual(target.ssh("id -u"), "0");
  assert.equal(target.ssh("uname -s"), "Linux");
  const image = "alpine:3.22";
  const scanner =
    "aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969";
  target.ssh(`docker pull ${image}`);
  const digest = target.ssh(`docker image inspect --format '{{.Id}}' ${image}`);
  assert.match(digest, /^sha256:[a-f0-9]{64}$/);
  target.ssh("mkdir -m 700 /home/deploy/scan-test");
  const run = (script, imageDigest = digest) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        "ssh",
        [
          "-i",
          target.key,
          "-p",
          String(target.port),
          "-o",
          "BatchMode=yes",
          "-o",
          "IdentitiesOnly=yes",
          "-o",
          "StrictHostKeyChecking=yes",
          "-o",
          `UserKnownHostsFile=${target.directory}/known_hosts`,
          "deploy@127.0.0.1",
          `TMPDIR=/home/deploy/scan-test bash -s -- ${scanner} ${imageDigest}`,
        ],
        { timeout: 540_000, maxBuffer: 8 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error && typeof error.code !== "number") reject(error);
          else resolve({ status: error?.code ?? 0, stdout, stderr });
        },
      );
      child.stdin.end(script);
    });
  const success = await run(trivyScanScript);
  assert.equal(success.status, 0, success.stderr);
  assert.equal(parseTrivyScanResult(success.stdout).scannerName, "trivy");
  assert.equal(
    target.ssh("find /home/deploy/scan-test -mindepth 1 -print"),
    "",
  );
  console.log("Production scan succeeded with a non-root private archive.");
  const inaccessible = await run(
    trivyScanScript.replace(
      '--volume "$image_file:/scan/image.tar:ro"',
      '--volume "$work_dir:/scan:ro"',
    ),
  );
  assert.notEqual(inaccessible.status, 0);
  assert.match(inaccessible.stderr, /permission denied/iu);
  assert.equal(
    target.ssh("find /home/deploy/scan-test -mindepth 1 -print"),
    "",
  );
  const failure = await run(trivyScanScript, `sha256:${"0".repeat(64)}`);
  assert.notEqual(failure.status, 0);
  assert.equal(
    target.ssh("find /home/deploy/scan-test -mindepth 1 -print"),
    "",
  );
  console.log(
    "Linux permission negative control and temporary archive cleanup verified.",
  );
} finally {
  target.close();
}
