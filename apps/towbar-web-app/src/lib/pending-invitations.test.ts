import assert from "node:assert/strict";
import test from "node:test";
import { getPendingInvitations } from "./pending-invitations";

test("pending invitations disappear at expiry without losing other active rows", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const invitation = (id: string, status: string, expiresAt: number) => ({
    id,
    status,
    expiresAt: new Date(expiresAt).toISOString(),
  });
  const items = [
    invitation("expired", "pending", now - 1),
    invitation("expires-now", "pending", now),
    invitation("soon", "pending", now + 1_000),
    invitation("accepted", "accepted", now + 10_000),
    invitation("revoked", "canceled", now + 10_000),
    invitation("later", "pending", now + 10_000),
    { id: "invalid", status: "pending", expiresAt: "invalid" },
  ];
  assert.deepEqual(
    getPendingInvitations(items, now).map((item) => item.id),
    ["soon", "later"],
  );
  assert.deepEqual(
    getPendingInvitations(items, now + 1_000).map((item) => item.id),
    ["later"],
  );
  assert.deepEqual(getPendingInvitations(items, now + 10_000), []);
});
