import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptCredential,
  encryptCredential,
  hashOpaqueToken,
  parseCredentialsMasterKey,
} from "./security.js";

void test("binds encrypted credentials to authenticated record context", () => {
  const masterKey = Buffer.alloc(32, 7);
  const envelope = encryptCredential({
    associatedData: "workspace:credential:record",
    masterKey,
    value: { secretAccessKey: "write-only" },
  });
  assert.equal(envelope.ciphertext.includes("write-only"), false);
  assert.deepEqual(
    decryptCredential({
      associatedData: "workspace:credential:record",
      envelope,
      masterKey,
    }),
    { secretAccessKey: "write-only" },
  );
  assert.throws(() =>
    decryptCredential({
      associatedData: "different-record",
      envelope,
      masterKey,
    }),
  );
});

void test("accepts only a Base64-encoded 32-byte credential key", () => {
  const encoded = Buffer.alloc(32, 7).toString("base64");
  assert.equal(parseCredentialsMasterKey(encoded).byteLength, 32);
  assert.throws(() => parseCredentialsMasterKey("short"));
  assert.throws(() => parseCredentialsMasterKey("a".repeat(64)));
});

void test("hashes high-entropy session tokens deterministically", () => {
  assert.equal(hashOpaqueToken("token"), hashOpaqueToken("token"));
  assert.notEqual(hashOpaqueToken("token"), hashOpaqueToken("other"));
});
