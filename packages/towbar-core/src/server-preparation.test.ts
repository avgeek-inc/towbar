import assert from "node:assert/strict";
import test from "node:test";

import {
  limitServerPreparationStepMessage,
  requiresServerPreparation,
  serverPreparationStepMessageMaxLength,
} from "./server-preparation.js";

import type { NormalizedServer } from "./manifest.js";

const server = {
  buildConcurrency: 2,
  ip: "203.0.113.10",
  proxy: {
    cloudflare: { enabled: true as const },
  },

  ssh: { host: "10.0.0.10", port: 22, username: "deploy" },
} satisfies NormalizedServer;

void test("limits server preparation messages to the API contract", () => {
  const message = "x".repeat(serverPreparationStepMessageMaxLength + 1);

  assert.equal(
    limitServerPreparationStepMessage(message).length,
    serverPreparationStepMessageMaxLength,
  );
});

void test("does not invalidate preparation for scheduler or routing changes", () => {
  assert.equal(
    requiresServerPreparation(server, { ...server, buildConcurrency: 10 }),
    false,
  );
  assert.equal(
    requiresServerPreparation(server, {
      ...server,
      proxy: {
        cloudflare: { enabled: true as const },
      },
    }),
    false,
  );
});

void test("invalidates preparation when SSH access changes", () => {
  assert.equal(
    requiresServerPreparation(server, {
      ...server,
      ssh: { ...server.ssh, username: "ubuntu" },
    }),
    true,
  );
  assert.equal(
    requiresServerPreparation(server, {
      ...server,
      ssh: { ...server.ssh, port: 2222 },
    }),
    true,
  );
});
