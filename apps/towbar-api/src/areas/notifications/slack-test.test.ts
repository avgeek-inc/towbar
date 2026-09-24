import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../http/errors.js";
import { sendTestSlackDestination } from "./slack-test.js";

void test("a sample Slack message can target only a saved channel", async () => {
  const sent: string[] = [];
  const dependencies = {
    getProvider: () => ({
      provider: "slack" as const,
      botToken: "xoxb-test-token-long-enough",
      appBaseUrl: "https://towbar.example.com",
    }),
    listDestinations: (workspaceId: string) => {
      assert.equal(workspaceId, "workspace-1");
      return Promise.resolve([{ id: "destination-1", channelId: "C12345678" }]);
    },
    deliver: (input: { config: unknown }) => {
      sent.push((input.config as { channelId: string }).channelId);
      return Promise.resolve();
    },
  };

  assert.deepEqual(
    await sendTestSlackDestination("workspace-1", "C12345678", dependencies),
    { status: "accepted" },
  );
  assert.deepEqual(sent, ["C12345678"]);

  await assert.rejects(
    sendTestSlackDestination("workspace-1", "C99999999", dependencies),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(sent.length, 1);
});
