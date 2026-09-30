import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actorAllows,
  actorActions,
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
    "secret.update",
    "sharedSecret.reference",
    "scout.configure",
    "alert.configure",
  ] as Action[]) {
    assert.equal(roleAllows("member", action), true);
    assert.equal(roleAllows("viewer", action), false);
  }
  for (const action of [
    "repository.connect",
    "repository.update",
    "repository.sync",
    "repository.disconnect",
    "deployment.create",
    "server.prepare",
    "server.terminal",
    "server.collectLogs",
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

test("scoped host log collection requires a saved administrative grant", () => {
  const actor: AccessActor = {
    kind: "team-key",
    workspaceId: "workspace",
    keyId: "key",
    policy: {
      scope: "team",
      access: "edit",
      includeAdmin: true,
      grants: ["deployment.create"],
    },
  };
  const required: Action[] = ["deployment.create", "server.collectLogs"];
  assert.equal(actorAllows(actor, required), false);
  assert.equal(
    actorAllows(
      { ...actor, policy: { ...actor.policy, grants: required } },
      required,
    ),
    true,
  );
  assert.equal(
    actorAllows(
      {
        ...actor,
        policy: { ...actor.policy, includeAdmin: false, grants: required },
      },
      required,
    ),
    false,
  );
  assert.equal(
    keyCeiling("member", "edit", false).includes("server.collectLogs"),
    false,
  );
});
test("full admin personal and team keys acquire current automation permissions", () => {
  for (const kind of ["personal-key", "team-key"] as const) {
    const base = {
      workspaceId: "workspace",
      keyId: "key",
      policy: {
        scope: kind === "personal-key" ? "personal" : "team",
        access: "edit",
        includeAdmin: true,
        permissionMode: "full-admin",
        grants: keyCeiling("admin", "edit", true).filter(
          (action) => action !== "server.collectLogs",
        ),
      } satisfies KeyPolicy,
    };
    const actor =
      kind === "personal-key"
        ? { ...base, kind, userId: "user", role: "admin" as const }
        : { ...base, kind };
    assert(actorAllows(actor, ["deployment.create", "server.collectLogs"]));
    assert.deepEqual(actorActions(actor), keyCeiling("admin", "edit", true));
    assert(!actorAllows(actor, ["server.collectLogs"], "another-workspace"));
    for (const action of [
      "server.terminal",
      "secret.reveal",
      "sharedSecret.reveal",
      "apikey.create",
      "member.update",
      "personal.manage",
      "privateKey.manage",
    ] as Action[])
      assert(!actorAllows(actor, [action]), action);
    assert(
      !actorAllows(
        { ...actor, policy: { ...actor.policy, permissionMode: "scoped" } },
        ["server.collectLogs"],
      ),
    );
    assert(
      !actorAllows({ ...actor, policy: { ...actor.policy, access: "read" } }, [
        "server.collectLogs",
      ]),
    );
    assert(
      !actorAllows(
        { ...actor, policy: { ...actor.policy, includeAdmin: false } },
        ["server.collectLogs"],
      ),
    );
    if (actor.kind === "personal-key") {
      assert(
        !actorAllows({ ...actor, role: "member" }, ["server.collectLogs"]),
      );
      assert(
        !actorAllows({ ...actor, role: "viewer" }, ["server.collectLogs"]),
      );
      assert(
        !actorAllows(
          {
            ...actor,
            tokenAttribution: {
              tokenType: "mcp-oauth",
              oauthClientId: "client",
              oauthClientName: "Client",
              oauthClientTrust: "unverified",
            },
          },
          ["server.collectLogs"],
        ),
      );
    }
  }
});
test("demotion permanently scopes a full admin key before re-promotion", () => {
  const admin: KeyPolicy = {
    scope: "personal",
    access: "edit",
    includeAdmin: true,
    permissionMode: "full-admin",
    grants: ["deployment.create"],
  };
  const member = constrainPersonalKey(admin, "member");
  assert.equal(member.permissionMode, "scoped");
  assert.equal(member.includeAdmin, false);
  assert.deepEqual(member.grants, keyCeiling("member", "edit", false));
  assert.deepEqual(constrainPersonalKey(member, "admin"), member);
  const viewer = constrainPersonalKey(admin, "viewer");
  assert.equal(viewer.permissionMode, "scoped");
  assert.equal(viewer.access, "read");
  assert.deepEqual(constrainPersonalKey(viewer, "admin"), viewer);
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
