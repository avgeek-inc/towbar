import assert from "node:assert/strict";
import test from "node:test";

import { getRuntimeNotifications } from "./runtime-notifications.js";

void test("keeps notifications absent unless explicitly enabled", () => {
  assert.deepEqual(getRuntimeNotifications({}), { providers: {}, routes: [] });
});

void test("loads provider credentials and enabled routes from one environment document", () => {
  const runtime = getRuntimeNotifications({
    TOWBAR_NOTIFICATION_CONFIG_JSON: JSON.stringify({
      providers: {
        smtp: {
          from: "towbar@example.com",
          host: "smtp.example.com",
          password: "secret",
          port: 587,
          secure: false,
          username: "towbar",
        },
      },
      routes: [
        {
          categories: ["deployments"],
          config: { recipients: ["ops@example.com"] },
          enabled: true,
          id: "ops-email",
          provider: "smtp",
        },
      ],
    }),
    TOWBAR_NOTIFICATIONS_ENABLED: "true",
  });

  assert.equal(runtime.providers.smtp?.provider, "smtp");
  assert.equal(runtime.routes[0]?.id, "ops-email");
});

void test("rejects duplicate routes and missing provider credentials", () => {
  const route = {
    categories: ["health"],
    config: { recipients: ["ops@example.com"] },
    enabled: true,
    id: "ops-email",
    provider: "smtp",
  };
  assert.throws(() =>
    getRuntimeNotifications({
      TOWBAR_NOTIFICATION_CONFIG_JSON: JSON.stringify({
        providers: {},
        routes: [route, route],
      }),
      TOWBAR_NOTIFICATIONS_ENABLED: "true",
    }),
  );
});
