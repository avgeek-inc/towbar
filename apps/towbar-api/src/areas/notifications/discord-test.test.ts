import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../http/errors.js";
import { sendTestDiscordDestination } from "./discord-test.js";

void test("a sample Discord notification uses only a configured webhook route", async () => {
  const sent: string[] = [];
  const dependencies = {
    getProvider: () => ({ provider: "discord" as const }),
    getRoute: (id: string) =>
      id === "operations-discord"
        ? {
            id,
            provider: "discord" as const,
            enabled: true,
            categories: ["deployments" as const],
            config: {
              webhookId: "123",
              webhookToken: "token",
            },
          }
        : null,
    deliver: (input: { config: unknown }) => {
      sent.push((input.config as { webhookId: string }).webhookId);
      return Promise.resolve();
    },
  };

  assert.deepEqual(
    await sendTestDiscordDestination("operations-discord", dependencies),
    { status: "accepted" },
  );
  assert.deepEqual(sent, ["123"]);
  await assert.rejects(
    sendTestDiscordDestination("missing-discord", dependencies),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
});
