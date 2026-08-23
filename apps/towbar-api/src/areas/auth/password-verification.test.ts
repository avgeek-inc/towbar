import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HttpError } from "../../http/errors.js";
import { PasswordVerificationGate } from "./password-verification.js";

void describe("password verification capacity", () => {
  void it("bounds active and queued password work", async () => {
    const gate = new PasswordVerificationGate(1, 1);
    let finishFirst!: () => void;
    const first = gate.run(
      () => new Promise<void>((resolve) => (finishFirst = resolve)),
    );
    const second = gate.run(() => Promise.resolve("second"));
    await Promise.resolve();

    await assert.rejects(
      gate.run(() => Promise.resolve("third")),
      (error: unknown) =>
        error instanceof HttpError && error.code === "AUTHENTICATION_BUSY",
    );

    finishFirst();
    await first;
    assert.equal(await second, "second");
  });
});
