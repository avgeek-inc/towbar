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
  "Scout loop survives a worker restart and replays its persisted history",
  { skip: !address, timeout: 60_000 },
  async () => {
    assert(
      address && /^(127\.0\.0\.1|localhost):\d+$/.test(address),
      "Use an explicit local Temporal test server",
    );
    const connection = await Connection.connect({ address });
    const native = await NativeConnection.connect({ address });
    const client = new Client({ connection, namespace: "default" });
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("./scout-alerts.workflow.ts", import.meta.url),
      ),
    });
    const taskQueue = `scout-test-${randomUUID()}`;
    let calls = 0;
    const waitFor = async (expected: number) => {
      const deadline = Date.now() + 12_000;
      while (calls < expected && Date.now() < deadline) await delay(30);
      assert(
        calls >= expected,
        `Expected ${expected} evaluations, got ${calls}`,
      );
    };
    const createWorker = () =>
      Worker.create({
        connection: native,
        namespace: "default",
        taskQueue,
        workflowBundle,
        activities: {
          evaluateScoutAlertsActivity: () => {
            calls++;
            return Promise.resolve({ evaluated: 1, more: false });
          },
        },
        shutdownGraceTime: "2 seconds",
      });
    let worker = await createWorker();
    let run = worker.run();
    const handle = await client.workflow.start("runScoutAlertsWorkflow", {
      taskQueue,
      workflowId: taskQueue,
    });
    try {
      await waitFor(1);
      await handle.signal("wakeScoutAlerts");
      await waitFor(2);
      worker.shutdown();
      await run;
      const beforeRestart = calls;
      await handle.signal("wakeScoutAlerts");
      worker = await createWorker();
      run = worker.run();
      await waitFor(beforeRestart + 1);
      assert.equal((await handle.describe()).status.name, "RUNNING");
      await handle.terminate("Scout integration test complete");
      worker.shutdown();
      await run;
      const history = await handle.fetchHistory();
      assert(history.events && history.events.length > 10);
      await Worker.runReplayHistory({ workflowBundle }, history);
    } finally {
      await handle.terminate("Scout test cleanup").catch(() => undefined);
      if (worker.getState() === "RUNNING") worker.shutdown();
      await run.catch(() => undefined);
      await native.close();
      await connection.close();
    }
  },
);
