import assert from "node:assert/strict";
import test from "node:test";

import { getRuntimeNotifications } from "../../infrastructure/runtime-notifications.js";
import {
  manifestNotificationAppId,
  manifestNotificationLabels,
  manifestNotificationRoutes,
} from "./manifest-destinations.js";

const appId = "31111111-1111-4111-8111-222222222222";
const runtime = getRuntimeNotifications({
  TOWBAR_NOTIFICATIONS_ENABLED: "true",
  TOWBAR_NOTIFICATION_CONFIG_JSON: JSON.stringify({
    providers: {
      smtp: {
        from: "towbar@example.com",
        host: "smtp.example.com",
        port: 587,
        secure: false,
      },
      slack: { botToken: "xoxb-example-token-long-enough" },
      discord: [
        { webhookId: "123456789012345678", webhookToken: "runtime-token" },
      ],
      telegram: { botToken: "123456:abcdefghijklmnopqrstuvwxyz" },
    },
    routes: [],
  }),
});

void test("routes manifest destinations through runtime credentials", () => {
  const notifications = {
    email: [
      {
        address: "ops@example.com",
        deployments: true,
        backupsAndRestores: false,
        alertsAndIncidents: false,
      },
    ],
    slack: [
      {
        channelId: "C12345678",
        deployments: false,
        backupsAndRestores: true,
        alertsAndIncidents: false,
      },
    ],
    discord: [
      {
        webhookId: "123456789012345678",
        deployments: false,
        backupsAndRestores: false,
        alertsAndIncidents: true,
      },
    ],
    telegram: [
      {
        chatId: "-1001234567890",
        messageThreadId: 42,
        deployments: true,
        backupsAndRestores: false,
        alertsAndIncidents: false,
      },
    ],
  };
  const routes = manifestNotificationRoutes(appId, notifications, runtime);
  assert.deepEqual(
    routes.map((route) => route.provider),
    ["smtp", "slack", "discord", "telegram"],
  );
  assert.deepEqual(routes[1]?.categories, ["backups", "restores"]);
  assert.deepEqual(routes[2]?.categories, ["health", "scout"]);
  assert.deepEqual(routes[2]?.config, {
    webhookId: "123456789012345678",
    webhookToken: "runtime-token",
  });
  assert.equal(
    routes[0]?.id,
    manifestNotificationRoutes(appId, notifications, runtime)[0]?.id,
  );
  assert.notEqual(
    routes[0]?.id,
    manifestNotificationRoutes(
      "31111111-1111-4111-8111-333333333333",
      notifications,
      runtime,
    )[0]?.id,
  );
  assert.deepEqual(
    manifestNotificationRoutes(appId, notifications, {
      providers: {},
      routes: [],
    }),
    [],
  );
  assert.equal(manifestNotificationAppId(routes[0]!.id), appId);
  assert.equal(manifestNotificationAppId("manifest-invalid"), null);
  const labels = manifestNotificationLabels(appId, notifications);
  assert.equal(labels.get(routes[0]!.id), "ops@example.com");
  assert.equal(labels.get(routes[1]!.id), "C12345678");
  assert.equal(labels.get(routes[2]!.id), "123456789012345678");
  assert.equal(labels.get(routes[3]!.id), "-1001234567890 · Topic 42");
});
