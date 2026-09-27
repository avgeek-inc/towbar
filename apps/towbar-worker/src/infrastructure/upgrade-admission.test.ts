import assert from "node:assert/strict";
import test from "node:test";
import { guardActivities, withUpgradeLease } from "./upgrade-admission.js";

void test("a denied or uncertain lease never executes worker work", async () => {
  let ran = false;
  await assert.rejects(
    withUpgradeLease(
      "deploy",
      () => {
        ran = true;
        return Promise.resolve();
      },
      () => Promise.reject(new Error("paused")),
    ),
    /paused/u,
  );
  assert.equal(ran, false);
});
void test("worker lease covers effects and cleanup and is released after failure", async () => {
  const events: string[] = [];
  await assert.rejects(
    withUpgradeLease(
      "cleanup",
      async () => {
        await Promise.resolve();
        events.push("effect");
        try {
          throw new Error("SSH failed");
        } finally {
          events.push("cleanup");
        }
      },
      <T>(_method: string, path: string) => {
        events.push(path.split("/").at(-1)!);
        return Promise.resolve({} as T);
      },
    ),
    /SSH failed/u,
  );
  assert.deepEqual(events, ["begin", "effect", "cleanup", "end"]);
});
void test("all activity exports are wrapped", () => {
  const activities = {
    deploy: () => Promise.resolve(1),
    scan: () => Promise.resolve(2),
  };
  const wrapped = guardActivities(activities);
  assert.deepEqual(Object.keys(wrapped), Object.keys(activities));
  assert.notEqual(wrapped.deploy, activities.deploy);
});

void test("an uncertain lease release preserves a completed activity result", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  let effects = 0;
  const result = { deploymentId: "deployed-once" };
  const actual = await withUpgradeLease(
    "deploy",
    () => {
      effects += 1;
      return Promise.resolve(result);
    },
    <T>(_method: string, path: string) =>
      path.endsWith("/end")
        ? Promise.reject(new Error("API unavailable"))
        : Promise.resolve({} as T),
  );
  assert.equal(actual, result);
  assert.equal(effects, 1);
  assert.equal(warning.mock.callCount(), 1);
});

void test("an uncertain lease release preserves the original activity error", async (t) => {
  const warning = t.mock.method(console, "warn", () => {});
  const originalError = new Error("SSH failed");
  await assert.rejects(
    withUpgradeLease(
      "deploy",
      () => Promise.reject(originalError),
      <T>(_method: string, path: string) =>
        path.endsWith("/end")
          ? Promise.reject(new Error("API unavailable"))
          : Promise.resolve({} as T),
    ),
    (error) => error === originalError,
  );
  assert.equal(warning.mock.callCount(), 1);
});
