import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client, Connection } from "@temporalio/client";
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
} from "@temporalio/worker";

const address = process.env.TOWBAR_TEST_TEMPORAL_ADDRESS;
void test(
  "transactional delivery resumes after restart with only outbox IDs in history",
  { skip: !address, timeout: 60_000 },
  async () => {
    assert(address && /^(127\.0\.0\.1|localhost):\d+$/.test(address));
    const connection = await Connection.connect({ address });
    const native = await NativeConnection.connect({ address });
    const client = new Client({ connection, namespace: "default" });
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("./transactional-email.workflow.ts", import.meta.url),
      ),
    });
    const taskQueue = `email-test-${randomUUID()}`;
    const input = { outboxId: randomUUID() };
    let calls = 0;
    const createWorker = () =>
      Worker.create({
        connection: native,
        namespace: "default",
        taskQueue,
        workflowBundle,
        shutdownGraceTime: "2 seconds",
        activities: {
          deliverTransactionalEmailActivity: (received: unknown) => {
            assert.deepEqual(received, input);
            calls++;
            if (calls === 2)
              return Promise.reject(
                new Error("Retryable delivery connection loss"),
              );
            return Promise.resolve(
              calls === 1
                ? { outcome: "wait", retryAfterMs: 1000 }
                : { outcome: "done" },
            );
          },
        },
      });
    let worker = await createWorker();
    let run = worker.run();
    const handle = await client.workflow.start(
      "runTransactionalEmailWorkflow",
      { taskQueue, workflowId: taskQueue, args: [input] },
    );
    try {
      const deadline = Date.now() + 12_000;
      while (calls === 0 && Date.now() < deadline) await delay(25);
      assert.equal(calls, 1);
      worker.shutdown();
      await run;
      worker = await createWorker();
      run = worker.run();
      await handle.result();
      assert.equal(calls, 3);
      const history = await handle.fetchHistory();
      const inputs =
        history.events?.flatMap(
          (event) =>
            event.workflowExecutionStartedEventAttributes?.input?.payloads ??
            event.activityTaskScheduledEventAttributes?.input?.payloads ??
            [],
        ) ?? [];
      assert(inputs.length >= 3);
      for (const payload of inputs)
        assert.deepEqual(
          JSON.parse(Buffer.from(payload.data!).toString()),
          input,
        );
      assert.equal((await handle.describe()).status.name, "COMPLETED");
      await Worker.runReplayHistory({ workflowBundle }, history);
    } finally {
      await handle.terminate("Email test cleanup").catch(() => undefined);
      if (worker.getState() === "RUNNING") worker.shutdown();
      await run.catch(() => undefined);
      await native.close();
      await connection.close();
    }
  },
);
