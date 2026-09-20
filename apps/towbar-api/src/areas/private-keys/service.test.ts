import assert from "node:assert/strict";
import { createPrivateKey } from "node:crypto";
import test from "node:test";

import { generateKey, normalizeManualKey } from "./service.js";

for (const algorithm of ["ed25519", "rsa"] as const) {
  void test(`generates a parseable ${algorithm.toUpperCase()} key pair for OpenSSH`, () => {
    const material = generateKey(algorithm, "Towbar test key");

    assert.equal(material.algorithm, algorithm);
    assert.equal(createPrivateKey(material.privateKey).type, "private");
    assert.match(
      material.publicKey ?? "",
      new RegExp(
        `^ssh-${algorithm === "ed25519" ? "ed25519" : "rsa"} [A-Za-z0-9+/=]+ Towbar test key$`,
      ),
    );
  });
}

void test("derives an omitted public key and rejects a mismatched supplied key", () => {
  const generated = generateKey("ed25519", "Imported key");
  const normalized = normalizeManualKey({
    name: "Imported key",
    privateKey: generated.privateKey,
  });

  assert.equal(normalized.publicKey, generated.publicKey);
  assert.throws(
    () =>
      normalizeManualKey({
        name: "Imported key",
        privateKey: generated.privateKey,
        publicKey: `ssh-ed25519 ${"A".repeat(68)}`,
      }),
    /public key does not match/i,
  );
});
