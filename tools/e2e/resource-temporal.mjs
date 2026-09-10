import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  deploymentWorkflowId,
  towbarTaskQueue,
  serverCoordinatorWorkflowId,
} from "../../packages/towbar-core/dist/temporal.js";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const apiRequire = createRequire(
  new URL("../../apps/towbar-api/package.json", import.meta.url),
);
const workerRequire = createRequire(
  new URL("../../apps/towbar-worker/package.json", import.meta.url),
);

export async function startResourceTemporal({ serverIp }) {
  const address = process.env.TOWBAR_TEST_TEMPORAL_ADDRESS;
  assert(
    address && /^(127\.0\.0\.1|localhost):\d+$/.test(address),
    "Use an explicit local Temporal test server",
  );
  const { serve } = apiRequire("@hono/node-server");
  const { createInternalApp } =
    await import("../../apps/towbar-api/dist/app.js");
  const app = createInternalApp();
  const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 });
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  process.env.TOWBAR_API_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  const { Client, Connection } = workerRequire("@temporalio/client");
  const { NativeConnection, Worker } = workerRequire("@temporalio/worker");
  let connection, native, worker, run;
  const handles = [];
  const close = async () => {
    for (const handle of handles) {
      if ((await handle.describe()).status.name === "RUNNING")
        await handle.terminate("Lifecycle test cleanup");
    }
    if (connection) {
      const client = new Client({
        connection,
        namespace: process.env.TEMPORAL_NAMESPACE,
      });
      const coordinator = client.workflow.getHandle(
        serverCoordinatorWorkflowId(
          createHash("sha256").update(serverIp).digest("hex").slice(0, 32),
        ),
      );
      try {
        if ((await coordinator.describe()).status.name === "RUNNING")
          await coordinator.terminate("Lifecycle test cleanup");
      } catch (error) {
        if (error.name !== "WorkflowNotFoundError") throw error;
      }
    }
    const { closeTemporalClient } =
      await import("../../apps/towbar-api/dist/infrastructure/temporal.js");
    await closeTemporalClient();
    if (worker?.getState() === "RUNNING") worker.shutdown();
    if (run) await run;
    if (native) await native.close();
    if (connection) await connection.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  };
  try {
    connection = await Connection.connect({ address });
    await connection.workflowService.registerNamespace({
      namespace: process.env.TEMPORAL_NAMESPACE,
      workflowExecutionRetentionPeriod: { seconds: 86400 },
    });
    native = await NativeConnection.connect({ address });
    const client = new Client({
      connection,
      namespace: process.env.TEMPORAL_NAMESPACE,
    });
    const taskQueue = towbarTaskQueue;
    const activities =
      await import("../../apps/towbar-worker/dist/activities/deployment.js");
    const workflowBundle = {
      codePath: fileURLToPath(
        new URL(
          "../../apps/towbar-worker/dist/workflow-bundle.js",
          import.meta.url,
        ),
      ),
    };
    worker = await Worker.create({
      connection: native,
      namespace: process.env.TEMPORAL_NAMESPACE,
      taskQueue,
      workflowBundle,
      activities: {
        ...activities,
        ...(await import("../../apps/towbar-worker/dist/activities/preview.js")),
      },
      shutdownGraceTime: "10 seconds",
    });
    run = worker.run();
    return {
      close,
      async execute(deploymentId) {
        const handle = client.workflow.getHandle(
          deploymentWorkflowId(deploymentId),
        );
        const deadline = Date.now() + 30_000;
        for (;;) {
          try {
            await handle.describe();
            break;
          } catch (error) {
            if (error.name !== "WorkflowNotFoundError" || Date.now() > deadline)
              throw error;
            await delay(100);
          }
        }
        handles.push(handle);
        await handle.result();
      },
      async verify(
        expectedStatuses = ["COMPLETED", "COMPLETED", "COMPLETED", "FAILED"],
      ) {
        const statuses = await Promise.all(
          handles.map(async (handle) => (await handle.describe()).status.name),
        );
        assert.deepEqual(statuses, expectedStatuses);
        for (const handle of handles)
          await Worker.runReplayHistory(
            { workflowBundle },
            await handle.fetchHistory(),
          );
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
