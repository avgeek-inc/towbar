import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../../http/errors.js";
import { sendTestEmailDestination } from "./email-test.js";

void test("a sample email can target only a saved destination", async () => {
  const sent: string[][] = [];
  const dependencies = {
    getProvider: () => ({
      provider: "smtp" as const,
      subjectPrefix: "Towbar" as const,
      from: "towbar@example.com",
      host: "smtp.example.com",
      port: 587,
      secure: false,
    }),
    listDestinations: (workspaceId: string) => {
      assert.equal(workspaceId, "workspace-1");
      return Promise.resolve([
        { id: "destination-1", email: "saved@example.com" },
      ]);
    },
    deliver: (input: { config: unknown }) => {
      sent.push((input.config as { recipients: string[] }).recipients);
      return Promise.resolve();
    },
  };

  assert.deepEqual(
    await sendTestEmailDestination(
      "workspace-1",
      "saved@example.com",
      dependencies,
    ),
    { status: "accepted" },
  );
  assert.deepEqual(sent, [["saved@example.com"]]);

  await assert.rejects(
    sendTestEmailDestination("workspace-1", "other@example.com", dependencies),
    (error: unknown) => error instanceof HttpError && error.status === 404,
  );
  assert.equal(sent.length, 1);
});
