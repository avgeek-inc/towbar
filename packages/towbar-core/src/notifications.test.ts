import assert from "node:assert/strict";
import test from "node:test";

import {
  discordRoutingInputSchema,
  emailConnectionInputSchema,
  emailRoutingInputSchema,
  notificationCategoryForEvent,
  notificationDestinationInputSchema,
  notificationEventPayloadSchema,
  slackChannelRoutingInputSchema,
  telegramConnectionInputSchema,
  telegramTopicRoutingInputSchema,
  webhookRoutingInputSchema,
} from "./notifications.js";

void test("maps notification events to independent subscription categories", () => {
  assert.equal(
    notificationCategoryForEvent("deployment.failed"),
    "deployments",
  );
  assert.equal(notificationCategoryForEvent("preview.ready"), "deployments");
  assert.equal(notificationCategoryForEvent("runtime.recovered"), "health");
  assert.equal(notificationCategoryForEvent("backup.stale"), "backups");
  assert.equal(notificationCategoryForEvent("restore.rolled_back"), "restores");
  assert.equal(notificationCategoryForEvent("notification.test"), "test");
});

void test("accepts provider targets without provider credentials", () => {
  const slack = notificationDestinationInputSchema.parse({
    categories: ["deployments"],
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

  for (const destination of [
    {
      config: { webhookId: "1", webhookToken: "token" },
      provider: "discord",
    },
    {
      config: { messageThreadId: 42 },
      provider: "telegram",
    },
    {
      config: { url: "https://example.com/towbar" },
      provider: "webhook",
    },
  ]) {
    assert.equal(
      notificationDestinationInputSchema.parse({
        categories: ["deployments"],
        enabled: true,
        ...destination,
      }).provider,
      destination.provider,
    );
  }
});

void test("accepts category routes for URL and Telegram providers", () => {
  assert.deepEqual(
    discordRoutingInputSchema.parse({
      routes: [
        {
          category: "scout",
          webhookUrl: "https://discord.com/api/webhooks/1/token",
        },
        { category: "deployments" },
      ],
    }).routes[1],
    { category: "deployments" },
  );
  assert.equal(
    webhookRoutingInputSchema.parse({
      routes: [{ category: "health", url: "https://example.com/towbar" }],
    }).routes[0]?.url,
    "https://example.com/towbar",
  );
  assert.equal(
    telegramConnectionInputSchema.parse({
      botToken: "123456:abcdefghijklmnopqrstuvwxyz",
      chatId: "-100123456",
    }).chatId,
    "-100123456",
  );
  assert.equal(
    telegramTopicRoutingInputSchema.parse({
      routes: [{ category: "deployments", messageThreadId: 23 }],
    }).routes[0]?.messageThreadId,
    23,
  );
});

void test("accepts one Slack channel per notification category", () => {
  assert.deepEqual(
    slackChannelRoutingInputSchema.parse({
      channels: [
        { category: "scout", channelId: "CALERTS" },
        { category: "deployments", channelId: "CDEPLOYS" },
      ],
    }).channels,
    [
      { category: "scout", channelId: "CALERTS" },
      { category: "deployments", channelId: "CDEPLOYS" },
    ],
  );
  assert.throws(() =>
    slackChannelRoutingInputSchema.parse({
      channels: [
        { category: "scout", channelId: "CALERTS" },
        { category: "scout", channelId: "COTHER" },
      ],
    }),
  );
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

void test("accepts SMTP as the workspace email connection", () => {
  const smtp = emailConnectionInputSchema.parse({
    from: "operator@example.com",
    host: "smtp.example.com",
    port: 587,
    secure: false,
  });
  assert.equal(smtp.host, "smtp.example.com");
  assert.throws(() =>
    emailConnectionInputSchema.parse({
      apiKey: "re_12345678901234567890",
      from: "operator@example.com",
      transport: "resend",
    }),
  );
});

void test("accepts comma-separated email routes as recipient arrays", () => {
  assert.deepEqual(
    emailRoutingInputSchema.parse({
      routes: [
        {
          category: "deployments",
          recipients: ["operator@example.com", "team@example.com"],
        },
      ],
    }),
    {
      routes: [
        {
          category: "deployments",
          recipients: ["operator@example.com", "team@example.com"],
        },
      ],
    },
  );
  assert.throws(() =>
    emailRoutingInputSchema.parse({
      routes: [{ category: "health", recipients: [] }],
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
