import assert from "node:assert/strict";
import test from "node:test";

import { CommandError } from "@workspace/towbar-deployer";

import { safeErrorMessage } from "./server-check.js";

void test("explains SSH public-key authentication failures", () => {
  const error = new CommandError(
    "ssh exited unsuccessfully",
    "",
    "ubuntu@203.0.113.10: Permission denied (publickey).\n",
  );

  assert.equal(
    safeErrorMessage(error),
    "SSH authentication failed. The selected private key is not authorized for the configured SSH username.",
  );
});

void test("explains SSH connection failures without exposing raw command output", () => {
  const cases = [
    {
      stderr:
        "ssh: connect to host 203.0.113.10 port 22: Connection timed out\n",
      expected:
        "The SSH connection timed out. Check the server address, SSH port, and firewall rules.",
    },
    {
      stderr: "ssh: connect to host 203.0.113.10 port 22: Connection refused\n",
      expected:
        "The server refused the SSH connection. Check the SSH port and that the SSH service is running.",
    },
    {
      stderr: "ssh: connect to host 203.0.113.10 port 22: No route to host\n",
      expected:
        "The server could not be reached over SSH. Check its network and firewall rules.",
    },
  ];

  for (const item of cases) {
    const error = new CommandError(
      "ssh exited unsuccessfully",
      "",
      item.stderr,
    );
    assert.equal(safeErrorMessage(error), item.expected);
    assert.doesNotMatch(safeErrorMessage(error), /203\.0\.113\.10/u);
  }
});

void test("preserves safe non-command errors", () => {
  assert.equal(
    safeErrorMessage(new Error("Server check failed")),
    "Server check failed",
  );
});
