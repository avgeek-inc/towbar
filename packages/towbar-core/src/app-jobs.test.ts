import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { appJobSchema, latestAppJobOccurrence } from "./app-jobs.js";
import { resolveRepositoryEnvironment } from "./manifest-v2.js";

const input = {
  name: "daily-report",
  command: ["node", "report.js"],
  schedule: { cron: "0 2 * * *" },
};
function resolve(jobs: unknown[], override?: unknown[]) {
  return resolveRepositoryEnvironment({
    root: stringify({
      version: 2,
      environments: { production: {}, staging: {} },
    }),
    branch: "main",
    environment: override ? "staging" : "production",
    files: [
      {
        path: ".towbar/apps/jobs.app.yml",
        content: stringify({
          id: "jobs",
          name: "Jobs",
          dockerfile: "Dockerfile",
          container: { port: 3000 },
          jobs,
          environments: {
            production: { server: "192.0.2.10" },
            staging: { server: "192.0.2.11", jobs: override ?? [] },
          },
        }),
      },
    ],
  });
}
void test("job manifests normalize defaults, reject invalid declarations and replace environment lists", () => {
  const job = appJobSchema.parse(input);
  assert.equal(job.timeoutSeconds, 300);
  assert.equal(job.schedule.timezone, "UTC");
  assert.deepEqual(resolve([input]).manifest.apps[0]!.jobs, [job]);
  assert.equal(resolve([input], []).manifest.apps[0]!.jobs, undefined);
  assert.notEqual(
    resolve([input]).digest,
    resolve([{ ...input, command: ["node", "other.js"] }]).digest,
  );
  assert.throws(() => resolve([input, input]));
  for (const invalid of [
    { ...input, schedule: { cron: "* * * * * *" } },
    { ...input, schedule: { cron: "@hourly" } },
    { ...input, schedule: { cron: "70 * * * *" } },
    { ...input, schedule: { cron: "* * * * *", timezone: "Asia/Kolkata" } },
    { ...input, name: "../../foreign" },
    { ...input, command: [] },
    { ...input, command: ["bad\0command"] },
    { ...input, timeoutSeconds: 3601 },
    { ...input, env: { SECRET: "inline" } },
  ])
    assert.throws(() => resolve([invalid]));
});
void test("job scheduler selects only the current UTC minute and does not replay missed runs", () => {
  const job = appJobSchema.parse(input);
  assert.equal(
    latestAppJobOccurrence(
      job,
      new Date("2026-09-17T02:00:00Z"),
    )?.toISOString(),
    "2026-09-17T02:00:00.000Z",
  );
  assert.equal(
    latestAppJobOccurrence(
      job,
      new Date("2026-09-17T02:00:59.999Z"),
    )?.toISOString(),
    "2026-09-17T02:00:00.000Z",
  );
  assert.equal(
    latestAppJobOccurrence(job, new Date("2026-09-17T02:01:00Z")),
    null,
  );
  assert.equal(
    latestAppJobOccurrence(
      { ...job, enabled: false },
      new Date("2026-09-17T02:00:00Z"),
    ),
    null,
  );
});
