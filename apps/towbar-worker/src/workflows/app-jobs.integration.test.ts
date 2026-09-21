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
  "job scheduler resumes after worker restart and its history replays",
  { skip: !address, timeout: 60_000 },
  async () => {
    assert(address && /^(127\.0\.0\.1|localhost):\d+$/.test(address));
    const connection = await Connection.connect({ address });
    const native = await NativeConnection.connect({ address });
    const client = new Client({ connection, namespace: "default" });
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("./app-jobs.workflow.ts", import.meta.url),
      ),
    });
    const taskQueue = `jobs-test-${randomUUID()}`;
    let calls = 0;
    const createWorker = () =>
      Worker.create({
        connection: native,
        namespace: "default",
        taskQueue,
        workflowBundle,
        shutdownGraceTime: "2 seconds",
        activities: {
          queueScheduledAppJobsActivity: () => {
            calls++;
            return Promise.resolve({ queued: 1, skipped: 0 });
          },
        },
      });
    let worker = await createWorker();
    let running = worker.run();
    const handle = await client.workflow.start("runAppJobsWorkflow", {
      taskQueue,
      workflowId: taskQueue,
      args: [],
    });
    async function waitForCalls(count: number) {
      const deadline = Date.now() + 10_000;
      while (calls < count && Date.now() < deadline) await delay(25);
      assert.ok(calls >= count);
    }
    try {
      await waitForCalls(1);
      worker.shutdown();
      await running;
      worker = await createWorker();
      running = worker.run();
      await handle.signal("wakeAppJobs");
      await waitForCalls(2);
      const history = await handle.fetchHistory();
      for (const event of history.events ?? []) {
        const input =
          event.activityTaskScheduledEventAttributes?.input?.payloads ?? [];
        assert.equal(
          input.length,
          0,
          "scheduler history must contain no credentials or job output",
        );
      }
      await Worker.runReplayHistory({ workflowBundle }, history);
    } finally {
      await handle
        .terminate("Scheduled job test cleanup")
        .catch(() => undefined);
      if (worker.getState() === "RUNNING") worker.shutdown();
      await running.catch(() => undefined);
      await native.close();
      await connection.close();
    }
  },
);
