import assert from "node:assert/strict";
import test from "node:test";
import {
  preferredSecondFactor,
  rememberedSecondFactor,
  rememberSecondFactor,
} from "./second-factor";

test("second-factor selection honors configured methods and browser support", () => {
  assert.equal(preferredSecondFactor(["totp"], true, null), "totp");
  assert.equal(preferredSecondFactor(["passkey"], true, null), "passkey");
  assert.equal(preferredSecondFactor(["totp", "passkey"], true, null), null);
  assert.equal(
    preferredSecondFactor(["totp", "passkey"], true, "totp"),
    "totp",
  );
  assert.equal(
    preferredSecondFactor(["totp", "passkey"], true, "passkey"),
    "passkey",
  );
  assert.equal(preferredSecondFactor(["totp"], true, "passkey"), "totp");
  assert.equal(preferredSecondFactor(["passkey"], true, "totp"), "passkey");
  assert.equal(
    preferredSecondFactor(["totp", "passkey"], false, "passkey"),
    null,
  );
  assert.equal(preferredSecondFactor(["passkey"], false, "passkey"), null);
  assert.equal(
    preferredSecondFactor(["totp", "passkey"], true, "invalid"),
    null,
  );
});

test("remembering is localhost-only and blocked storage cannot interrupt sign-in", () => {
  const values = new Map<string, string>();
  const browser = {
    location: { hostname: "localhost" },
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: browser,
    });
    rememberSecondFactor("passkey");
    assert.equal(rememberedSecondFactor(), "passkey");
    browser.location.hostname = "towbar.example";
    assert.equal(rememberedSecondFactor(), null);
    rememberSecondFactor("totp");
    browser.location.hostname = "localhost";
    assert.equal(rememberedSecondFactor(), "passkey");
    Object.defineProperty(browser, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    });
    assert.equal(rememberedSecondFactor(), null);
    assert.doesNotThrow(() => rememberSecondFactor("totp"));
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
