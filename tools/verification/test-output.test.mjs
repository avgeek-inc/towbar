import assert from "node:assert/strict";
import test from "node:test";
import { requiredTestCounts } from "./test-output.mjs";

const summary = (overrides = {}) =>
  Object.entries({
    tests: 3,
    pass: 3,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
    ...overrides,
  })
    .map(([name, count]) => `# ${name} ${count}`)
    .join("\n");

test("required suites accept a complete TAP run", () => {
  assert.equal(
    requiredTestCounts(`TAP version 13\nok 1 - example\n${summary()}\n`).pass,
    3,
  );
});
for (const reason of ["fail", "cancelled", "skipped", "todo"]) {
  test(`required suites reject ${reason} even if the child exits successfully`, () => {
    assert.throws(
      () => requiredTestCounts(summary({ pass: 2, [reason]: 1 })),
      new RegExp(reason),
    );
  });
}
test("required suites reject missing, empty, duplicate and incomplete summaries", () => {
  for (const output of [
    "",
    "Everything passed",
    summary({ tests: 0, pass: 0 }),
    `${summary()}\n${summary()}`,
    summary({ pass: 2 }),
  ])
    assert.throws(() => requiredTestCounts(output));
});
