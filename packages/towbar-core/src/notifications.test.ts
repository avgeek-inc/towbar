import assert from "node:assert/strict";
import test from "node:test";

import {
  notificationCategoryForEvent,
  notificationDestinationInputSchema,
  notificationEventPayloadSchema,
} from "./notifications.js";

void test("maps notification events to independent subscription categories", () => {
  assert.equal(
    notificationCategoryForEvent("deployment.failed"),
    "deployments",
  );
  assert.equal(notificationCategoryForEvent("preview.ready"), "previews");
  assert.equal(notificationCategoryForEvent("runtime.recovered"), "health");
  assert.equal(notificationCategoryForEvent("backup.stale"), "backups");
  assert.equal(notificationCategoryForEvent("restore.rolled_back"), "restores");
  assert.equal(notificationCategoryForEvent("notification.test"), "test");
});

void test("accepts provider targets without provider credentials", () => {
  const slack = notificationDestinationInputSchema.parse({
    categories: ["deployments", "previews"],
    config: { channelId: "C12345678" },
    enabled: true,
    provider: "slack",
  });
  assert.equal(slack.provider, "slack");

  const smtp = notificationDestinationInputSchema.parse({
    categories: ["health", "backups"],
    config: {
      recipients: ["operator@example.com"],
    },
    enabled: false,
    provider: "smtp",
  });
  assert.equal(smtp.provider, "smtp");
});

void test("rejects inline provider credentials", () => {
  assert.throws(() =>
    notificationDestinationInputSchema.parse({
      categories: ["deployments"],
      config: { webhookUrl: "https://hooks.slack.com/services/T/B/token" },
      enabled: true,
      provider: "slack",
    }),
  );
  assert.throws(() =>
    notificationDestinationInputSchema.parse({
      categories: ["health"],
      config: {
        password: "must not be accepted",
        recipients: ["operator@example.com"],
      },
      enabled: true,
      provider: "smtp",
    }),
  );
});

void test("keeps event payloads provider-neutral", () => {
  assert.throws(() =>
    notificationEventPayloadSchema.parse({
      details: {},
      entity: { id: "app-1", kind: "app", name: "API" },
      message: "Deployment succeeded",
      occurredAt: "2026-08-30T00:00:00.000Z",
      secret: "must not be accepted",
      source: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "platform",
      },
      title: "Deployment succeeded",
    }),
  );
});
