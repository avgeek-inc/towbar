import assert from "node:assert/strict";
import test from "node:test";

import {
  notificationCategoryForEvent,
  notificationDestinationInputSchema,
  notificationEventPayloadSchema,
  smtpNotificationSecretSchema,
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

void test("accepts provider configuration that stores credentials by reference", () => {
  const slack = notificationDestinationInputSchema.parse({
    categories: ["deployments", "previews"],
    config: {},
    enabled: true,
    name: "Deployments",
    provider: "slack",
    secretReference: "aws:production/notifications/slack",
  });
  assert.equal(slack.provider, "slack");

  const smtp = notificationDestinationInputSchema.parse({
    categories: ["health", "backups"],
    config: {
      from: "towbar@example.com",
      host: "smtp.example.com",
      port: 587,
      recipients: ["operator@example.com"],
      secure: false,
      subjectPrefix: "Towbar",
    },
    enabled: false,
    name: "Operations email",
    provider: "smtp",
    secretReference: "aws:production/notifications/smtp",
  });
  assert.equal(smtp.provider, "smtp");
});

void test("rejects inline provider credentials and mail header injection", () => {
  assert.throws(() =>
    notificationDestinationInputSchema.parse({
      categories: ["deployments"],
      config: { webhookUrl: "https://hooks.slack.com/services/T/B/token" },
      enabled: true,
      name: "Slack",
      provider: "slack",
      secretReference: "aws:production/notifications/slack",
    }),
  );
  assert.throws(() =>
    notificationDestinationInputSchema.parse({
      categories: ["health"],
      config: {
        from: "towbar@example.com",
        host: "smtp.example.com",
        port: 587,
        recipients: ["operator@example.com"],
        secure: false,
        subjectPrefix: "Towbar\r\nBcc: attacker@example.com",
      },
      enabled: true,
      name: "Email",
      provider: "smtp",
      secretReference: "aws:production/notifications/smtp",
    }),
  );
});

void test("keeps resolved SMTP secrets strict and payloads provider-neutral", () => {
  assert.throws(() =>
    smtpNotificationSecretSchema.parse({
      password: "secret",
      region: "us-east-1",
      username: "operator",
    }),
  );
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
