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

import {
  CommandError,
  HostKeyNotTrustedError,
} from "@workspace/towbar-deployer";

import {
  executeServerCheckActivity,
  markServerCheckInterruptedActivity,
} from "../activities/server-check.js";

const address = process.env.TOWBAR_TEST_TEMPORAL_ADDRESS;

void test(
  "both server coordinators advance after recorded SSH failures and recover unrecorded failures",
  { skip: !address, timeout: 60_000 },
  async (t) => {
    assert(address && /^(127\.0\.0\.1|localhost):\d+$/u.test(address));
    process.env.TOWBAR_INTERNAL_API_BASE_URL = "http://127.0.0.1:4023";
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = "test".repeat(8);
    const connection = await Connection.connect({ address });
    const native = await NativeConnection.connect({ address });
    const client = new Client({ connection, namespace: "default" });
    try {
      for (const [workflow, file] of [
        ["runServerCoordinatorWorkflow", "./server-coordinator.workflow.ts"],
        [
          "runConcurrentServerCoordinatorWorkflow",
          "./concurrent-server-coordinator.workflow.ts",
        ],
      ] as const) {
        await t.test(workflow, async (caseTest) => {
          const hostKeyId = randomUUID();
          const authenticationId = randomUUID();
          const unrecordedId = randomUUID();
          const nextId = randomUUID();
          const events: { id: string; errorCode?: string; status: string }[] =
            [];
          const interruptions: string[] = [];
          const discovered = [
            {
              algorithm: "ssh-ed25519",
              fingerprint: "SHA256:test",
              publicKey: "test",
            },
          ];
          caseTest.mock.method(
            globalThis,
            "fetch",
            (target: URL, init?: RequestInit) => {
              const parts = target.pathname.split("/");
              const id = parts.at(-2)!;
              if (parts.at(-1) === "context") {
                if (id === hostKeyId)
                  throw new HostKeyNotTrustedError(discovered);
                throw new CommandError(
                  "ssh exited unsuccessfully",
                  "",
                  "Permission denied (publickey).",
                );
              }
              if (parts.at(-1) === "interrupt") {
                interruptions.push(id);
                return Promise.resolve(
                  Response.json({ check: { id, status: "failed" } }),
                );
              }
              assert.equal(parts.at(-1), "events");
              if (id === unrecordedId)
                return Promise.resolve(
                  Response.json(
                    { error: { message: "Result could not be saved" } },
                    { status: 422 },
                  ),
                );
              const body = JSON.parse(String(init?.body));
              if (id === hostKeyId)
                assert.deepEqual(body.result, {
                  discoveredHostKeys: discovered,
                });
              events.push({
                id,
                errorCode: body.errorCode,
                status: body.status,
              });
              return Promise.resolve(Response.json({ check: { id, ...body } }));
            },
          );
          const workflowBundle = await bundleWorkflowCode({
            workflowsPath: fileURLToPath(new URL(file, import.meta.url)),
          });
          const taskQueue = `server-check-test-${randomUUID()}`;
          const worker = await Worker.create({
            connection: native,
            namespace: "default",
            taskQueue,
            workflowBundle,
            shutdownGraceTime: "2 seconds",
            activities: {
              executeServerCheckActivity,
              markServerCheckInterruptedActivity,
            },
          });
          const run = worker.run();
          const handle = await client.workflow.start(workflow, {
            taskQueue,
            workflowId: taskQueue,
          });
          try {
            for (const id of [
              hostKeyId,
              authenticationId,
              unrecordedId,
              nextId,
            ])
              await handle.signal("enqueueServerWork", {
                id,
                kind: "server-check",
                buildConcurrency: 1,
              });
            const deadline = Date.now() + 12_000;
            while (
              !events.some((event) => event.id === nextId) &&
              Date.now() < deadline
            )
              await delay(25);
            assert.deepEqual(events, [
              {
                id: hostKeyId,
                errorCode: "HOST_KEY_NOT_TRUSTED",
                status: "failed",
              },
              {
                id: authenticationId,
                errorCode: "SERVER_CHECK_FAILED",
                status: "failed",
              },
              {
                id: nextId,
                errorCode: "SERVER_CHECK_FAILED",
                status: "failed",
              },
            ]);
            assert.deepEqual(interruptions, [unrecordedId]);
            assert.equal((await handle.describe()).status.name, "RUNNING");
            await handle.terminate("Server check regression test complete");
            worker.shutdown();
            await run;
            await Worker.runReplayHistory(
              { workflowBundle },
              await handle.fetchHistory(),
            );
          } finally {
            await handle
              .terminate("Server check test cleanup")
              .catch(() => undefined);
            if (worker.getState() === "RUNNING") worker.shutdown();
            await run.catch(() => undefined);
          }
        });
      }
    } finally {
      await native.close();
      await connection.close();
    }
  },
);
