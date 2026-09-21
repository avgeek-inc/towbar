import assert from "node:assert/strict";
import test from "node:test";
import { serverPreparationStepLogMaxLength } from "@workspace/towbar-core";
import {
  createPreparationLog,
  redactPreparationOutput,
} from "./server-preparation-log.js";

void test("redacts secrets split across output chunks before every publication", async () => {
  const snapshots: string[] = [];
  const log = createPreparationLog({
    sensitiveValues: ["test-private-secret"],
    publish: (value) => {
      snapshots.push(value);
      return Promise.resolve();
    },
  });
  await log.append("stderr", "API token 'split-");
  assert.equal(snapshots.length, 0);
  await log.append("stderr", "token' appears invalid\n");
  await log.append("stdout", "test-private-");
  await log.append("stdout", "secret\n");
  await log.append(
    "stderr",
    "-----BEGIN OPENSSH PRIVATE KEY-----\nprivate-body\n",
  );
  await log.append(
    "stderr",
    "-----END OPENSSH PRIVATE KEY-----\nUseful diagnostic",
  );
  await log.finish();
  assert.ok(snapshots.length > 0);
  for (const snapshot of snapshots)
    assert.doesNotMatch(
      snapshot,
      /split-token|test-private-secret|private-body/,
    );
  assert.match(snapshots.at(-1)!, /Useful diagnostic/);
  assert.match(snapshots.at(-1)!, /API token '\[redacted\]'/);
});

void test("bounds retained output, keeps the final diagnostic, and reports truncation", async () => {
  let output = "";
  let truncated = false;
  const log = createPreparationLog({
    sensitiveValues: [],
    publish: (value, isTruncated) => {
      output = value;
      truncated = isTruncated;
      return Promise.resolve();
    },
  });
  await log.append("stdout", "Installed package\n".repeat(5_000));
  await log.append("stderr", "Final error: disk full\n");
  await log.finish();
  assert.equal(output.length, serverPreparationStepLogMaxLength);
  assert.equal(truncated, true);
  assert.ok(output.endsWith("[stderr] Final error: disk full\n"));
});

void test("omits oversized partial lines without leaking an incomplete token", async () => {
  let output = "";
  const log = createPreparationLog({
    sensitiveValues: [],
    publish: (value) => {
      output = value;
      return Promise.resolve();
    },
  });
  await log.append("stderr", `API token '${"secret".repeat(10_000)}`);
  await log.append("stderr", "rest' invalid\nDone\n");
  await log.finish();
  assert.doesNotMatch(output, /secret|rest/);
  assert.match(output, /Oversized output line omitted/);
  assert.match(output, /Done/);
});

void test("strips terminal controls and redacts credential diagnostics", () => {
  const value = redactPreparationOutput(
    '\u001b[31mError\u001b[0m password="sensitive" api_token=another Authorization: Bearer token https://user:pass@example.com\n',
  );
  assert.doesNotMatch(value, /sensitive|another|Bearer token|user:pass/);
  assert.equal(value.includes("\u001b"), false);
  assert.match(value, /Error/);
});
