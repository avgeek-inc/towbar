import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(
  new URL("../../apps/towbar-worker/package.json", import.meta.url),
);
const { Client, Connection } = require("@temporalio/client");
const {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
} = require("@temporalio/worker");
const execute = promisify(execFile);
const compose = JSON.parse(process.env.VERIFY_COMPOSE_ARGS ?? "null");
const project = process.env.VERIFY_COMPOSE_PROJECT;
const address = process.env.TOWBAR_TEST_TEMPORAL_ADDRESS;
assert.match(project ?? "", /^towbar-verify-[a-f\d-]{36}$/);
assert.match(address ?? "", /^127\.0\.0\.1:\d+$/);
assert.ok(Array.isArray(compose) && compose[0] === "compose");
assert.equal(compose[compose.indexOf("--project-name") + 1], project);
async function docker(args) {
  const { stdout } = await execute("docker", args, {
    timeout: 360_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout.trim();
}
const container = await docker([...compose, "ps", "--quiet", "temporal"]);
assert.ok(container);
for (const service of ["temporal", "postgres", "worker"]) {
  const id = await docker([...compose, "ps", "--quiet", service]);
  assert.equal(
    await docker([
      "inspect",
      "--format",
      '{{index .Config.Labels "com.docker.compose.project"}}',
      id,
    ]),
    project,
  );
}

const workflowBundle = await bundleWorkflowCode({
  workflowsPath: fileURLToPath(
    new URL(
      "../../apps/towbar-worker/src/workflows/transactional-email.workflow.ts",
      import.meta.url,
    ),
  ),
});
const taskQueue = `production-recovery-${randomUUID()}`;
const input = { outboxId: randomUUID() };
let calls = 0;
let worker;
let running;
let native;
let connection;
let handle;
const connect = async () => {
  connection = await Connection.connect({ address });
  native = await NativeConnection.connect({ address });
  return new Client({ connection, namespace: "default" });
};
const startWorker = async () => {
  worker = await Worker.create({
    connection: native,
    namespace: "default",
    taskQueue,
    workflowBundle,
    shutdownGraceTime: "1 second",
    activities: {
      deliverTransactionalEmailActivity: async (received) => {
        assert.deepEqual(received, input);
        calls++;
        return calls === 1
          ? { outcome: "wait", retryAfterMs: 30_000 }
          : { outcome: "done" };
      },
    },
  });
  running = worker.run();
  // Register the rejection handler immediately while lifecycle commands run.
  running.catch(() => {});
};
const stopWorker = async () => {
  if (worker?.getState() === "RUNNING") worker.shutdown();
  if (running) await running;
  worker = undefined;
  running = undefined;
  await native?.close();
  await connection?.close();
  native = undefined;
  connection = undefined;
};

try {
  let client = await connect();
  await startWorker();
  handle = await client.workflow.start("runTransactionalEmailWorkflow", {
    taskQueue,
    workflowId: taskQueue,
    args: [input],
    workflowExecutionTimeout: "3 minutes",
  });
  const deadline = Date.now() + 20_000;
  let persistedTimer = false;
  while (Date.now() < deadline) {
    persistedTimer =
      (await handle.fetchHistory()).events?.some(
        (event) => event.timerStartedEventAttributes,
      ) ?? false;
    if (persistedTimer) break;
    await delay(100);
  }
  assert.ok(
    persistedTimer,
    "Workflow must persist an activity result and timer before shutdown",
  );
  assert.equal(calls, 1);
  const before = await handle.describe();
  await stopWorker();

  await docker([...compose, "stop", "worker", "temporal"]);
  await docker([...compose, "rm", "--force", "temporal"]);
  await docker([...compose, "restart", "postgres"]);
  await docker([
    ...compose,
    "up",
    "--detach",
    "--wait",
    "--wait-timeout",
    "300",
  ]);
  assert.notEqual(
    await docker([...compose, "ps", "--quiet", "temporal"]),
    container,
  );
  console.log(
    "PASS Production PostgreSQL restarted and Temporal was recreated without deleting data",
  );

  client = await connect();
  handle = client.workflow.getHandle(taskQueue);
  assert.equal((await handle.describe()).runId, before.runId);
  await startWorker();
  await handle.result();
  assert.equal(
    calls,
    2,
    "Completed activity must not run again after server recreation",
  );
  assert.equal((await handle.describe()).status.name, "COMPLETED");
  const history = await handle.fetchHistory();
  for (const payload of history.events.flatMap(
    (event) =>
      event.workflowExecutionStartedEventAttributes?.input?.payloads ??
      event.activityTaskScheduledEventAttributes?.input?.payloads ??
      [],
  )) {
    assert.deepEqual(JSON.parse(Buffer.from(payload.data).toString()), input);
  }
  await Worker.runReplayHistory({ workflowBundle }, history);
  console.log(
    "PASS Persisted workflow resumed exactly once and its complete history replayed",
  );
} finally {
  try {
    if (handle && connection)
      await handle.terminate("Disposable verification cleanup").catch(() => {});
  } finally {
    await stopWorker();
  }
}
