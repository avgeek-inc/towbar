import assert from "node:assert/strict";
import test from "node:test";
import { preferredSecondFactor } from "./second-factor";

test("passkeys are preferred whenever available in a supported browser", () => {
  assert.equal(preferredSecondFactor(["totp", "passkey"], true), "passkey");
  assert.equal(preferredSecondFactor(["passkey", "totp"], true), "passkey");
  assert.equal(preferredSecondFactor(["passkey"], true), "passkey");
});

test("unsupported passkeys fall back to an authenticator when configured", () => {
  assert.equal(preferredSecondFactor(["totp", "passkey"], false), "totp");
  assert.equal(preferredSecondFactor(["totp"], true), "totp");
  assert.equal(preferredSecondFactor(["totp"], false), "totp");
  assert.equal(preferredSecondFactor(["passkey"], false), null);
  assert.equal(preferredSecondFactor([], true), null);
});
