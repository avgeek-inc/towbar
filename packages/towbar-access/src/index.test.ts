import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actorAllows,
  allActions,
  canCreateKey,
  constrainPersonalKey,
  keyCeiling,
  roleAllows,
  workspaceRoles,
  type AccessActor,
  type Action,
  type KeyPolicy,
} from "./index.js";

test("roles separate operational reads, member edits, and administration", () => {
  for (const role of workspaceRoles) {
    for (const action of [
      "repository.read",
      "deployment.read",
      "server.read",
      "scout.read",
      "personal.manage",
    ] as Action[])
      assert.equal(roleAllows(role, action), true, `${role}: ${action}`);
  }
  for (const action of [
    "repository.connect",
    "secret.update",
    "sharedSecret.reference",
    "scout.configure",
    "alert.configure",
  ] as Action[]) {
    assert.equal(roleAllows("member", action), true);
    assert.equal(roleAllows("viewer", action), false);
  }
  for (const action of [
    "deployment.create",
    "server.prepare",
    "server.terminal",
    "integration.manage",
    "secret.reveal",
    "privateKey.manage",
    "member.create",
    "team.update",
  ] as Action[]) {
    assert.equal(roleAllows("admin", action), true);
    assert.equal(roleAllows("member", action), false);
    assert.equal(roleAllows("viewer", action), false);
  }
  assert.ok(allActions.every((action) => roleAllows("admin", action)));
});
test("API keys cannot grant browser privileges or escape their ceilings", () => {
  assert(!keyCeiling("admin", "edit", true).includes("server.terminal"));
  const actor: AccessActor = {
    kind: "personal-key",
    workspaceId: "w",
    userId: "u",
    role: "viewer",
    keyId: "k",
    policy: {
      scope: "personal",
      access: "edit",
      includeAdmin: true,
      grants: allActions,
    },
  };
  assert.equal(actorAllows(actor, ["repository.read"]), true);
  for (const action of [
    "repository.sync",
    "secret.reveal",
    "server.prepare",
    "personal.manage",
    "apikey.create",
  ] as Action[])
    assert.equal(actorAllows(actor, [action]), false);
  assert.equal(
    actorAllows(actor, ["repository.read"], "another-workspace"),
    false,
  );
  assert.equal(actorAllows(actor, []), false);
  const team: AccessActor = {
    kind: "team-key",
    workspaceId: "w",
    keyId: "k",
    policy: {
      scope: "team",
      access: "edit",
      includeAdmin: true,
      grants: ["server.prepare"],
    },
  };
  assert.equal(actorAllows(team, ["server.prepare"]), true);
  assert.equal(actorAllows(team, ["repository.read"]), false);
});
test("downgrade strips grants permanently and preserves only previous grants", () => {
  const admin: KeyPolicy = {
    scope: "personal",
    access: "edit",
    includeAdmin: true,
    grants: keyCeiling("admin", "edit", true),
  };
  const member = constrainPersonalKey(admin, "member");
  assert.equal(member.includeAdmin, false);
  assert.ok(!member.grants.includes("server.prepare"));
  const viewer = constrainPersonalKey(member, "viewer");
  assert.equal(viewer.access, "read");
  assert.ok(!viewer.grants.includes("repository.sync"));
  assert.deepEqual(constrainPersonalKey(viewer, "admin"), viewer);
  assert.deepEqual(
    constrainPersonalKey({ ...admin, grants: [] }, "member").grants,
    [],
  );
});
test("creation choices enforce role and scope independently", () => {
  assert.equal(
    canCreateKey("viewer", {
      scope: "personal",
      access: "read",
      includeAdmin: false,
    }),
    true,
  );
  assert.equal(
    canCreateKey("viewer", {
      scope: "personal",
      access: "edit",
      includeAdmin: false,
    }),
    false,
  );
  assert.equal(
    canCreateKey("member", {
      scope: "team",
      access: "edit",
      includeAdmin: false,
    }),
    false,
  );
  assert.equal(
    canCreateKey("member", {
      scope: "personal",
      access: "edit",
      includeAdmin: true,
    }),
    false,
  );
  assert.equal(
    canCreateKey("admin", {
      scope: "team",
      access: "read",
      includeAdmin: true,
    }),
    false,
  );
  assert.equal(
    canCreateKey("admin", {
      scope: "team",
      access: "edit",
      includeAdmin: true,
    }),
    true,
  );
});
