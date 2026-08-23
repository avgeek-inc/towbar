import assert from "node:assert/strict";
import { test } from "node:test";

import { runCommand } from "./process.js";

void test("streams process output before command completion", async () => {
  let completed = false;
  let outputSeen!: () => void;
  const firstOutput = new Promise<void>((resolve) => {
    outputSeen = resolve;
  });
  const execution = runCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write('first\\n'); setTimeout(() => process.stdout.write('last\\n'), 250)",
    ],
    {
      onStdout: () => outputSeen(),
    },
  ).finally(() => {
    completed = true;
  });

  await firstOutput;
  assert.equal(completed, false);
  assert.equal((await execution).stdout, "first\nlast\n");
});
