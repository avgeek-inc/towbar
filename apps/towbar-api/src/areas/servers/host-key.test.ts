import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTrustedHostKey } from "./host-key.js";

const publicKey =
  "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAABAgMEBQYHCAkKCwwNDg8QERITFBUWFxgZGhscHR4f";
const fingerprint = "SHA256:ZkAslGjFiUHdGf/WUL8rQvkib4PTvQatUV0OUQSncCA";

void describe("parseTrustedHostKey", () => {
  void it("accepts a matching OpenSSH public key and SHA-256 fingerprint", () => {
    assert.deepEqual(
      parseTrustedHostKey({
        algorithm: "ssh-ed25519",
        fingerprint,
        publicKey,
      }),
      { algorithm: "ssh-ed25519", fingerprint, publicKey },
    );
  });

  void it("rejects a fingerprint that was not derived from the submitted key", () => {
    assert.throws(
      () =>
        parseTrustedHostKey({
          algorithm: "ssh-ed25519",
          fingerprint: "SHA256:not-the-submitted-key",
          publicKey,
        }),
      /fingerprint does not match/u,
    );
  });

  void it("rejects a declared algorithm that differs from the key payload", () => {
    assert.throws(
      () =>
        parseTrustedHostKey({
          algorithm: "ssh-rsa",
          fingerprint,
          publicKey,
        }),
      /declared algorithm/u,
    );
  });
});
