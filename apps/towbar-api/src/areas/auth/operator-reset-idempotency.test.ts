import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyPassword } from "@workspace/towbar-core/security";

import {
  createOperatorResetIdempotencyMarker,
  matchesOperatorResetIdempotencyMarker,
} from "./operator-reset-idempotency.js";

void describe("operator reset idempotency", () => {
  const input = {
    email: "owner@example.com",
    internalHmacSecret: "an-internal-secret-with-sufficient-length",
    temporaryPassword: "a-high-entropy-temporary-password",
  };

  void it("creates a deterministic marker bound to the internal key and reset value", () => {
    const marker = createOperatorResetIdempotencyMarker(input);

    assert.match(marker, /^[a-f\d]{64}$/u);
    assert.equal(createOperatorResetIdempotencyMarker(input), marker);
    assert.notEqual(
      createOperatorResetIdempotencyMarker({
        ...input,
        internalHmacSecret: "a-different-internal-secret-of-safe-length",
      }),
      marker,
    );
    assert.notEqual(
      createOperatorResetIdempotencyMarker({
        ...input,
        temporaryPassword: "a-different-high-entropy-password",
      }),
      marker,
    );
    assert.equal(marker.includes(input.email), false);
    assert.equal(marker.includes(input.temporaryPassword), false);
  });

  void it("matches only a valid stored marker and cannot serve as a login verifier", async () => {
    const marker = createOperatorResetIdempotencyMarker(input);

    assert.equal(matchesOperatorResetIdempotencyMarker(marker, marker), true);
    assert.equal(matchesOperatorResetIdempotencyMarker(marker, null), false);
    assert.equal(
      matchesOperatorResetIdempotencyMarker(marker, "malformed"),
      false,
    );
    assert.equal(await verifyPassword(input.temporaryPassword, marker), false);
  });
});
