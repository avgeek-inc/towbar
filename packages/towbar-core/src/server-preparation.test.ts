import assert from "node:assert/strict";
import test from "node:test";

import {
  limitServerPreparationStepMessage,
  requiresServerPreparation,
  serverPreparationStepMessageMaxLength,
} from "./server-preparation.js";
import { normalizeServerConfiguration } from "./manifest.js";

import type { NormalizedServer } from "./manifest.js";

const server = {
  buildConcurrency: 2,
  ip: "203.0.113.10",
  ssh: { host: "10.0.0.10", port: 22, username: "deploy" },
} satisfies NormalizedServer;

void test("limits server preparation messages to the API contract", () => {
  const message = "x".repeat(serverPreparationStepMessageMaxLength + 1);

  assert.equal(
    limitServerPreparationStepMessage(message).length,
    serverPreparationStepMessageMaxLength,
  );
});

void test("does not invalidate preparation for scheduler changes", () => {
  assert.equal(
    requiresServerPreparation(server, { ...server, buildConcurrency: 10 }),
    false,
  );
});

void test("server configuration does not accept a Cloudflare TLS toggle", () => {
  const configuration = {
    ip: "203.0.113.10",
    ssh: { username: "deploy" },
    proxy: { cloudflare: { enabled: true } },
  };
  assert.throws(() => normalizeServerConfiguration(configuration));
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
