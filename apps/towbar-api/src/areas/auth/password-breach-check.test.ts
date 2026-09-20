import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { isPasswordCompromised } from "./password-breach-check.js";
void test("password corpus requests use only a padded hash prefix with a deadline", async () => {
  const password = "Synthetic security test passphrase";
  const hash = createHash("sha1").update(password).digest("hex").toUpperCase();
  const request: typeof fetch = (input, init) => {
    assert.equal(
      input,
      `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`,
    );
    assert(!JSON.stringify([input, init]).includes(password));
    assert.equal(new Headers(init?.headers).get("Add-Padding"), "true");
    assert(init?.signal);
    assert.equal(init.redirect, "error");
    return Promise.resolve(
      new Response(`${hash.slice(5)}:1\r\n${"0".repeat(35)}:0`),
    );
  };
  assert.equal(await isPasswordCompromised(password, request), true);
  assert.equal(
    await isPasswordCompromised(password, () =>
      Promise.resolve(new Response(`${hash.slice(5)}:0`)),
    ),
    false,
  );
});
void test("password corpus errors and malformed responses fail safely", async () => {
  for (const response of [
    new Response("failure", { status: 503 }),
    new Response(""),
    new Response("<html>error</html>"),
  ]) {
    await assert.rejects(
      isPasswordCompromised("Fixture passphrase", () =>
        Promise.resolve(response),
      ),
      /temporarily unavailable/,
    );
  }
  await assert.rejects(
    isPasswordCompromised("Fixture passphrase", () =>
      Promise.reject(new Error("private diagnostic")),
    ),
    (error) =>
      error instanceof Error && !error.message.includes("private diagnostic"),
  );
});
