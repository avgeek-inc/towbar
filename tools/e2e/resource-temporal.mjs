import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const apiRequire = createRequire(
  new URL("../../apps/towbar-api/package.json", import.meta.url),
);
const workerRequire = createRequire(
  new URL("../../apps/towbar-worker/package.json", import.meta.url),
);

export async function startResourceTemporal() {
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
    native = await NativeConnection.connect({ address });
    const client = new Client({ connection, namespace: "default" });
    const taskQueue = `resource-lifecycle-${randomUUID()}`;
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
      namespace: "default",
      taskQueue,
      workflowBundle,
      activities,
      shutdownGraceTime: "10 seconds",
    });
    run = worker.run();
    return {
      close,
      async execute(deploymentId) {
        const handle = await client.workflow.start("runDeploymentWorkflow", {
          taskQueue,
          workflowId: deploymentId,
          args: [{ deploymentId }],
          workflowExecutionTimeout: "5 minutes",
        });
        handles.push(handle);
        await handle.result();
      },
      async verify() {
        const statuses = await Promise.all(
          handles.map(async (handle) => (await handle.describe()).status.name),
        );
        assert.deepEqual(statuses, [
          "COMPLETED",
          "COMPLETED",
          "COMPLETED",
          "FAILED",
        ]);
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
