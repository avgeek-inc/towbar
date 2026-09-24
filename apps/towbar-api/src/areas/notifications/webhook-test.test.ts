import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../http/errors.js";
import { sendTestWebhookDestination } from "./webhook-test.js";

void test("a sample Webhook notification uses only a configured webhook route", async () => {
  const sent: string[] = [];
  const dependencies = {
    getProvider: () => ({ provider: "webhook" as const }),
    getRoute: (id: string) =>
      id === "operations-webhook"
        ? {
            id,
            provider: "webhook" as const,
            enabled: true,
            categories: ["deployments" as const],
            config: {
              url: "https://hooks.example.com/events",
              signingSecret: "a-signing-secret-with-at-least-32-characters",
            },
          }
        : null,
    deliver: (input: { config: unknown }) => {
      sent.push((input.config as { url: string }).url);
      return Promise.resolve();
    },
  };

  assert.deepEqual(
    await sendTestWebhookDestination("operations-webhook", dependencies),
    { status: "accepted" },
  );
  assert.deepEqual(sent, ["https://hooks.example.com/events"]);
  await assert.rejects(
    sendTestWebhookDestination("missing-webhook", dependencies),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});
