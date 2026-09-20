import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import ssh2 from "ssh2";
import { terminalPrivateKey } from "./terminal-key.js";

void test("terminal accepts generated PKCS8 ED25519, RSA and manual OpenSSH private keys", () => {
  const pairs = [
    generateKeyPairSync("ed25519"),
    generateKeyPairSync("rsa", { modulusLength: 2048 }),
  ];
  for (const pair of pairs) {
    const pem = pair.privateKey
      .export({ format: "pem", type: "pkcs8" })
      .toString();
    const converted = terminalPrivateKey(pem);
    const key = ssh2.utils.parseKey(converted);
    assert(!(key instanceof Error) && !Array.isArray(key));
    const data = Buffer.from("SSH terminal key proof");
    const signature = key.sign(data);
    assert(!(signature instanceof Error));
    assert.equal(key.verify(data, signature), true);
    assert.equal(
      terminalPrivateKey(converted.toString()),
      converted.toString(),
    );
  }
});
