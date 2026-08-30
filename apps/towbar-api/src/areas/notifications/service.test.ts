import assert from "node:assert/strict";
import test from "node:test";

import { retryDelayMs } from "./delivery-service.js";
import { notificationEventPayload } from "./service.js";

void test("uses bounded exponential notification retry delays", () => {
  assert.equal(retryDelayMs(1), 5_000);
  assert.equal(retryDelayMs(2), 10_000);
  assert.equal(retryDelayMs(20), 300_000);
});

void test("normalizes provider-neutral event payloads without secrets", () => {
  const payload = notificationEventPayload(
    {
      entity: { id: "deployment-1", kind: "deployment", name: "API" },
      message: "Deployment completed",
      source: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "platform",
      },
      title: "Deployment succeeded",
    },
    new Date("2026-08-30T00:00:00.000Z"),
  );
  assert.equal(payload.occurredAt, "2026-08-30T00:00:00.000Z");
  assert.deepEqual(payload.details, {});
});
