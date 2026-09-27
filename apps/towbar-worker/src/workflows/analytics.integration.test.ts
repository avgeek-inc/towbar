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
  "analytics maintenance persists its daily timer across worker restart",
  { skip: !address, timeout: 60_000 },
  async () => {
    assert(address && /^(127\.0\.0\.1|localhost):\d+$/u.test(address));
    const connection = await Connection.connect({ address });
    const native = await NativeConnection.connect({ address });
    const client = new Client({ connection, namespace: "default" });
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("./analytics.workflow.ts", import.meta.url),
      ),
    });
    const taskQueue = `analytics-test-${randomUUID()}`;
    let calls = 0;
    const createWorker = () =>
      Worker.create({
        connection: native,
        namespace: "default",
        taskQueue,
        workflowBundle,
        activities: {
          maintainAnalyticsActivity: () => {
            calls++;
            return Promise.resolve();
          },
        },
        shutdownGraceTime: "2 seconds",
      });
    let worker = await createWorker();
    let run = worker.run();
    const handle = await client.workflow.start("runAnalyticsWorkflow", {
      taskQueue,
      workflowId: taskQueue,
    });
    try {
      let history = await handle.fetchHistory();
      const deadline = Date.now() + 12000;
      while (
        !history.events?.some((e) => e.timerStartedEventAttributes) &&
        Date.now() < deadline
      ) {
        await delay(50);
        history = await handle.fetchHistory();
      }
      assert.equal(calls, 1);
      const timer = history.events?.find(
        (e) => e.timerStartedEventAttributes,
      )?.timerStartedEventAttributes;
      assert.equal(Number(timer?.startToFireTimeout?.seconds), 86400);
      worker.shutdown();
      await run;
      worker = await createWorker();
      run = worker.run();
      assert.equal((await handle.describe()).status.name, "RUNNING");
      assert.equal(calls, 1);
      await handle.terminate("Analytics integration test complete");
      worker.shutdown();
      await run;
      await Worker.runReplayHistory(
        { workflowBundle },
        await handle.fetchHistory(),
      );
    } finally {
      await handle.terminate("Analytics test cleanup").catch(() => undefined);
      if (worker.getState() === "RUNNING") worker.shutdown();
      await run.catch(() => undefined);
      await native.close();
      await connection.close();
    }
  },
);
