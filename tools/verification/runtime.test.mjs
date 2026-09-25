import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { testEnvironment, verificationRun } from "./runtime.mjs";

test("verification removes inherited provider and database configuration", () => {
  const env = testEnvironment({
    PATH: "/usr/bin",
    DATABASE_TOWBAR_URL: "must-not-inherit",
    TOWBAR_TEST_DATABASE_URL: "must-not-inherit",
    TOWBAR_CREDENTIALS_KEY: "must-not-inherit",
    TEMPORAL_ADDRESS: "must-not-inherit",
    AWS_PROFILE: "must-not-inherit",
    GOOGLE_APPLICATION_CREDENTIALS: "must-not-inherit",
    GCLOUD_PROJECT: "must-not-inherit",
    GCP_PROJECT: "must-not-inherit",
    NODE_ENV: "production",
  });
  assert.deepEqual(env, {
    PATH: "/usr/bin",
    CI: "1",
    SENTRY_ALLOW_MISSING: "true",
    NODE_ENV: "test",
  });
});

test("required commands persist failures for skips, empty runs, exit errors and timeouts", async () => {
  const run = await verificationRun("runner-test");
  try {
    await assert.rejects(
      run.step("empty", process.execPath, ["-e", ""], { requiredTests: true }),
      /TAP/,
    );
    const skipped =
      "# tests 1\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0";
    await assert.rejects(
      run.step(
        "skipped",
        process.execPath,
        ["-e", `console.log(${JSON.stringify(skipped)})`],
        { requiredTests: true },
      ),
      /passing tests/,
    );
    await assert.rejects(
      run.step("exit", process.execPath, ["-e", "process.exit(7)"]),
      /exited 7/,
    );
    await assert.rejects(
      run.step(
        "timeout",
        process.execPath,
        ["-e", "setInterval(() => {}, 1000)"],
        { timeoutMs: 200 },
      ),
      /time limit/,
    );
    const results = JSON.parse(
      await readFile(path.join(run.directory, "results.json"), "utf8"),
    );
    assert.equal(results.results.length, 4);
    assert.ok(results.results.every((result) => result.status === "failed"));
    assert.equal(
      results.results.find((result) => result.name === "exit").exitCode,
      7,
    );
  } finally {
    run.finish();
    await rm(run.directory, { recursive: true, force: true });
  }
});
