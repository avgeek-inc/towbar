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
  "log forwarding reconciles servers after worker restart without credentials in history",
  { skip: !address, timeout: 60_000 },
  async () => {
    assert(address && /^(127\.0\.0\.1|localhost):\d+$/.test(address));
    const connection = await Connection.connect({ address });
    const native = await NativeConnection.connect({ address });
    const client = new Client({ connection, namespace: "default" });
    const workflowBundle = await bundleWorkflowCode({
      workflowsPath: fileURLToPath(
        new URL("./log-drains.workflow.ts", import.meta.url),
      ),
    });
    const taskQueue = `log-drains-test-${randomUUID()}`;
    let calls = 0;
    const serverId = randomUUID();
    const createWorker = () =>
      Worker.create({
        connection: native,
        namespace: "default",
        taskQueue,
        workflowBundle,
        shutdownGraceTime: "2 seconds",
        activities: {
          listLogDrainServersActivity: () => Promise.resolve([{ serverId }]),
          reconcileLogDrainServerActivity: (id: string) => {
            assert.equal(id, serverId);
            calls++;
            return Promise.resolve();
          },
        },
      });
    let worker = await createWorker();
    let running = worker.run();
    const handle = await client.workflow.start("runLogDrainsWorkflow", {
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
      await handle.signal("wakeLogDrains");
      await waitForCalls(2);
      const history = await handle.fetchHistory();
      for (const event of history.events ?? []) {
        const input =
          event.activityTaskScheduledEventAttributes?.input?.payloads ?? [];
        if (
          event.activityTaskScheduledEventAttributes?.activityType?.name ===
          "listLogDrainServersActivity"
        ) {
          assert.equal(input.length, 0);
        } else if (event.activityTaskScheduledEventAttributes) {
          assert.equal(input.length, 1);
          assert.equal(
            JSON.parse(Buffer.from(input[0]!.data!).toString()),
            serverId,
          );
        }
      }
      await Worker.runReplayHistory({ workflowBundle }, history);
    } finally {
      await handle
        .terminate("Log forwarding test cleanup")
        .catch(() => undefined);
      if (worker.getState() === "RUNNING") worker.shutdown();
      await running.catch(() => undefined);
      await native.close();
      await connection.close();
    }
  },
);
