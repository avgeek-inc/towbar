import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDeploymentActivity } from "./overview";

void test("activity includes exactly seven UTC dates across month boundaries", () => {
  const days = buildDeploymentActivity(
    [
      { createdAt: "2026-08-31T23:59:59Z", state: "succeeded_with_warnings" },
      { createdAt: "2026-09-01T00:00:00Z", state: "failed" },
      { createdAt: "2026-08-27T23:59:59Z", state: "succeeded" },
      { createdAt: "2026-09-04T00:00:00Z", state: "queued" },
    ],
    new Date("2026-09-03T12:00:00Z"),
  );
  assert.equal(days.length, 7);
  assert.equal(days[0]?.date, "2026-08-28");
  assert.equal(days[6]?.date, "2026-09-03");
  assert.equal(
    days.reduce((total, day) => total + day.total, 0),
    2,
  );
  assert.equal(days.find((day) => day.date === "2026-08-31")?.succeeded, 1);
  assert.equal(days.find((day) => day.date === "2026-09-01")?.failed, 1);
});
