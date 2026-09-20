import assert from "node:assert/strict";
import test from "node:test";
import { recoveryArguments } from "./recovery-arguments.js";

void test("host recovery accepts only explicit, unambiguous account and security options", () => {
  assert.deepEqual(
    recoveryArguments(
      [
        "--email=OLD@example.com",
        "--new-email=new@example.com",
        "--reset-mfa",
        "--remove-passkeys",
      ],
      "admin",
    ),
    {
      email: "old@example.com",
      newEmail: "new@example.com",
      resetMfa: true,
      removePasskeys: true,
    },
  );
  for (const args of [
    [],
    ["--email=bad"],
    ["--email=a@example.com", "--email=b@example.com"],
    ["--email=a@example.com", "--reset-mfa=false"],
    ["--email=a@example.com", "--password=hidden"],
    ["--email=a@example.com", "--new-email="],
  ]) {
    assert.throws(() => recoveryArguments(args, "admin"));
  }
  assert.throws(() =>
    recoveryArguments(
      ["--email=a@example.com", "--new-email=b@example.com"],
      "mfa",
    ),
  );
  assert.equal(
    recoveryArguments(["--email=a@example.com", "--remove-passkeys"], "mfa")
      .removePasskeys,
    true,
  );
});
