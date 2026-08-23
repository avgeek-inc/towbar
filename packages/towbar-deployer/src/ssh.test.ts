import assert from "node:assert/strict";
import test from "node:test";

import { sshConnectionHost } from "./ssh.js";

import type { NormalizedServer } from "@workspace/towbar-core";

const server: NormalizedServer = {
  buildConcurrency: 1,
  ip: "203.0.113.10",
  secrets: { login: "aws:example/server-login" },
  ssh: { host: "10.0.0.10", port: 22, username: "deploy" },
};

void test("uses the private SSH host without changing the public server IP", () => {
  assert.equal(sshConnectionHost(server), "10.0.0.10");
  assert.equal(server.ip, "203.0.113.10");
});

void test("keeps historical snapshots executable when ssh.host is absent", () => {
  const historical = structuredClone(server);
  delete (historical.ssh as { host?: string }).host;
  assert.equal(sshConnectionHost(historical), "203.0.113.10");
});
