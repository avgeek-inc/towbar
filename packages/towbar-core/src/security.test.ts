import assert from "node:assert/strict";
import test from "node:test";

import {
  decryptCredential,
  encryptCredential,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
} from "./security.js";

void test("hashes passwords with Argon2id and verifies without exposing the password", async () => {
  const encoded = await hashPassword("a-long-test-password");
  assert.match(encoded, /^\$towbar\$argon2id\$/u);
  assert.equal(await verifyPassword("a-long-test-password", encoded), true);
  assert.equal(await verifyPassword("a-different-password", encoded), false);
});

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

void test("hashes high-entropy session tokens deterministically", () => {
  assert.equal(hashOpaqueToken("token"), hashOpaqueToken("token"));
  assert.notEqual(hashOpaqueToken("token"), hashOpaqueToken("other"));
});
