import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deploymentLogChunkCharacterLimit } from "@workspace/towbar-core/temporal";

import { runWithSafeLogs, safeLog } from "./executor-hooks.js";
import { CommandError } from "./process.js";

void describe("executor hooks", () => {
  void it("redacts and records command output before rethrowing a failure", async () => {
    const secret = "very-sensitive-value";
    const failure = new CommandError(
      "ssh exited unsuccessfully",
      `stdout ${secret}`,
      `stderr ${secret}`,
    );
    const logs: { content: string; stream: "stderr" | "stdout" }[] = [];

    await assert.rejects(
      runWithSafeLogs({
        hooks: {
          log(content, stream) {
            logs.push({ content, stream });
            return Promise.resolve();
          },
        },
        run: () => Promise.reject(failure),
        sensitiveValues: [secret],
      }),
      (error) => error === failure,
    );

    assert.deepEqual(logs, [
      { content: "stdout [REDACTED]", stream: "stdout" },
      { content: "stderr [REDACTED]", stream: "stderr" },
    ]);
  });

  void it("records successful command output", async () => {
    const logs: { content: string; stream: "stderr" | "stdout" }[] = [];

    const result = await runWithSafeLogs({
      hooks: {
        log(content, stream) {
          logs.push({ content, stream });
          return Promise.resolve();
        },
      },
      run: () => Promise.resolve({ stderr: "warning", stdout: "built" }),
      sensitiveValues: [],
    });

    assert.deepEqual(result, { stderr: "warning", stdout: "built" });
    assert.deepEqual(logs, [
      { content: "built", stream: "stdout" },
      { content: "warning", stream: "stderr" },
    ]);
  });

  void it("records command output while the command is still running", async () => {
    const logs: string[] = [];
    let finishCommand!: () => void;
    const commandFinished = new Promise<void>((resolve) => {
      finishCommand = resolve;
    });
    let outputRecorded!: () => void;
    const recorded = new Promise<void>((resolve) => {
      outputRecorded = resolve;
    });

    const execution = runWithSafeLogs({
      hooks: {
        log(content) {
          logs.push(content);
          outputRecorded();
          return Promise.resolve();
        },
      },
      run: async (handlers) => {
        await handlers.onStdout?.("Building layer 1\n");
        await commandFinished;
        return { stderr: "", stdout: "Building layer 1\n" };
      },
      sensitiveValues: [],
    });

    await recorded;
    assert.deepEqual(logs, ["Building layer 1\n"]);
    finishCommand();
    await execution;
    assert.deepEqual(logs, ["Building layer 1\n"]);
  });

  void it("redacts before splitting output into API-sized chunks", async () => {
    const secret = "very-sensitive-value";
    const content = `${secret}${"a".repeat(deploymentLogChunkCharacterLimit + 1)}`;
    const logs: string[] = [];

    await safeLog(
      {
        log(chunk) {
          logs.push(chunk);
          return Promise.resolve();
        },
      },
      content,
      "stdout",
      [secret],
    );

    assert.equal(logs.length, 2);
    assert.ok(
      logs.every((chunk) => chunk.length <= deploymentLogChunkCharacterLimit),
    );
    assert.equal(logs.join(""), content.replace(secret, "[REDACTED]"));
    assert.ok(logs.every((chunk) => !chunk.includes(secret)));
  });
});
