import assert from "node:assert/strict";
import test from "node:test";
import { createKeySchema } from "./create-key-contract.js";

void test("manual key creation requires an explicit name, permissions and expiry", () => {
  const valid = {
    name: "Automation",
    access: "read",
    includeAdmin: false,
    expiresAt: "2027-01-01T00:00:00.000Z",
  };
  for (const field of Object.keys(valid)) {
    const incomplete = { ...valid } as Record<string, unknown>;
    delete incomplete[field];
    assert.equal(createKeySchema.safeParse(incomplete).success, false, field);
  }
  assert.equal(
    createKeySchema.safeParse({ ...valid, name: "  " }).success,
    false,
  );
  assert.equal(
    createKeySchema.safeParse({ ...valid, includeAdmin: true }).success,
    false,
  );
  assert.equal(
    createKeySchema.safeParse({ ...valid, expiresAt: null }).success,
    true,
  );
  assert.equal(
    createKeySchema.safeParse({ ...valid, access: "edit", includeAdmin: true })
      .success,
    true,
  );
});
