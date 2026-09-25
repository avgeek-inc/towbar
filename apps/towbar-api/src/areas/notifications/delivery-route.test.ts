import assert from "node:assert/strict";
import test from "node:test";

import { resolveNotificationDeliveryRoute } from "./delivery-route.js";

void test("runtime routes can use a manifest-prefixed identifier", async () => {
  const previousEnabled = process.env.TOWBAR_NOTIFICATIONS_ENABLED;
  const previousConfig = process.env.TOWBAR_NOTIFICATION_CONFIG_JSON;
  process.env.TOWBAR_NOTIFICATIONS_ENABLED = "true";
  process.env.TOWBAR_NOTIFICATION_CONFIG_JSON = JSON.stringify({
    providers: {
      smtp: {
        from: "towbar@example.com",
        host: "smtp.example.com",
        port: 587,
        secure: false,
      },
    },
    routes: [
      {
        id: "manifest-ops",
        provider: "smtp",
        enabled: true,
        categories: ["deployments"],
        config: { recipients: ["ops@example.com"] },
      },
    ],
  });
  try {
    const route = await resolveNotificationDeliveryRoute(
      "31111111-1111-4111-8111-222222222222",
      "manifest-ops",
      "smtp",
    );
    assert.equal(route?.id, "manifest-ops");
  } finally {
    if (previousEnabled === undefined)
      delete process.env.TOWBAR_NOTIFICATIONS_ENABLED;
    else process.env.TOWBAR_NOTIFICATIONS_ENABLED = previousEnabled;
    if (previousConfig === undefined)
      delete process.env.TOWBAR_NOTIFICATION_CONFIG_JSON;
    else process.env.TOWBAR_NOTIFICATION_CONFIG_JSON = previousConfig;
  }
});
