import assert from "node:assert/strict";
import test from "node:test";

import { enqueueClaimedPreviewCleanups } from "./cleanup-admission.js";

void test("marks every cleanup admission failure and still attempts the batch", async () => {
  const attempted: string[] = [];
  const failed: string[] = [];
  const environments = [
    { appId: "app-1", id: "preview-1", serverId: "server-1" },
    { appId: "app-2", id: "preview-2", serverId: "missing-server" },
    { appId: "app-3", id: "preview-3", serverId: "server-1" },
  ];

  await assert.rejects(
    enqueueClaimedPreviewCleanups({
      enqueue: (environment) => {
        attempted.push(environment.id);
        return environment.id === "preview-1"
          ? Promise.reject(new Error("queue offline"))
          : Promise.resolve();
      },
      environments,
      markFailed: (environment) => {
        failed.push(environment.id);
        return Promise.resolve();
      },
      serverById: new Map([
        [
          "server-1",
          {
            buildConcurrency: 4,
            ip: "192.0.2.10",
            previewBuildConcurrency: 2,
          },
        ],
      ]),
    }),
    /queue offline/u,
  );

  assert.deepEqual(attempted, ["preview-1", "preview-3"]);
  assert.deepEqual(failed, ["preview-1", "preview-2"]);
});
