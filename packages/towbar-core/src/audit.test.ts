import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEventCatalog,
  auditEventDefinitions,
  auditEventIcons,
  auditEventMetadata,
  isAuditEventSlug,
} from "./audit.js";
void test("audit catalog has stable slugs, unique labels, icons, and explicit metadata", () => {
  assert.equal(
    new Set(auditEventDefinitions.map((event) => event.label)).size,
    auditEventDefinitions.length,
  );
  for (const { slug, label, icon } of auditEventDefinitions) {
    assert.match(slug, /^[a-z][a-z0-9_-]*(?:\.[a-z][a-z0-9_-]*)+$/);
    assert(label.trim());
    assert(isAuditEventSlug(slug));
    assert(auditEventIcons.includes(icon));
    assert.equal(icon, auditEventCatalog[slug].icon);
    assert(Array.isArray(auditEventCatalog[slug].metadata));
  }
  assert(!isAuditEventSlug("toString"));
  assert(!isAuditEventSlug("__proto__"));
});
void test("audit metadata excludes unregistered fields and invalid scalar values", () => {
  assert.deepEqual(
    auditEventMetadata("member.role-changed", {
      role: "viewer",
      previousRole: "member",
      password: "secret",
    }),
    { role: "viewer", previousRole: "member" },
  );
  assert.deepEqual(
    auditEventMetadata("unregistered.event", { token: "secret" }),
    {},
  );
  assert.deepEqual(
    auditEventMetadata("secrets.revealed", {
      keyCount: Infinity,
      key: "PUBLIC_NAME",
      privateKey: "secret",
    }),
    { key: "PUBLIC_NAME" },
  );
  assert.equal(
    String(
      auditEventMetadata("member.updated", { name: "x".repeat(4000) }).name,
    ).length,
    2000,
  );
});
