import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { actorAllows } from "@workspace/towbar-access";
import {
  apiKeyPolicies,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "full admin personal keys permanently narrow on demotion while team keys remain independent",
  { skip: !url },
  async () => {
    assert(url && new URL(url).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = url;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    process.env.TOWBAR_PASSWORD_BREACH_CHECK = "false";
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: url,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const keys = await import("./service.js");
    const teams = await import("../team/service.js");
    const { withActor, captureQueuedActor, authorizeQueuedEffect } =
      await import("../auth/actor-context.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID();
    const admin = {
      id: randomUUID(),
      email: `${randomUUID()}@example.test`,
      name: "Admin",
      workspaceId,
      workspaceRole: "admin" as const,
    };
    const owner = {
      ...admin,
      id: randomUUID(),
      email: `${randomUUID()}@example.test`,
      name: "Owner",
    };
    try {
      await db
        .insert(workspaces)
        .values({ id: workspaceId, slug: workspaceId, name: "Key policy" });
      await db.insert(users).values(
        [admin, owner].map((user) => ({
          id: user.id,
          email: user.email,
          displayName: user.name,
        })),
      );
      const members = await db
        .insert(workspaceMembers)
        .values(
          [admin, owner].map((user) => ({
            workspaceId,
            userId: user.id,
            role: "admin" as const,
          })),
        )
        .returning();
      const ownerMembership = members.find(
        (member) => member.userId === owner.id,
      )!;
      const team = await keys.createApiKey(owner, {
        name: "Independent team",
        scope: "team",
        access: "edit",
        includeAdmin: true,
      });
      assert(team.token);
      const teamToken = team.token;
      const full = await keys.createApiKey(owner, {
        name: "Full personal",
        access: "edit",
        includeAdmin: true,
      });
      assert(full.token);
      assert.equal(full.key.permissionMode, "full-admin");
      await db
        .update(apiKeyPolicies)
        .set({
          grants: full.key.grants.filter(
            (action) => action !== "server.collectLogs",
          ),
        })
        .where(eq(apiKeyPolicies.keyId, full.key.id));
      const principal = (await keys.findApiKey(full.token))!;
      assert(actorAllows(principal.actor, ["server.collectLogs"]));
      const reference = withActor(principal.actor, () =>
        captureQueuedActor(admin.workspaceId, [
          "deployment.create",
          "server.collectLogs",
        ]),
      ).requestedByActor;
      const admitted = await authorizeQueuedEffect(
        reference,
        admin.workspaceId,
        ["server.collectLogs"],
      );
      assert(actorAllows(admitted, ["server.collectLogs"]));
      const narrowed = await authorizeQueuedEffect(
        { ...reference, grants: ["repository.read"] },
        admin.workspaceId,
        ["repository.read"],
      );
      assert(!actorAllows(narrowed, ["server.collectLogs"]));
      assert(!actorAllows(narrowed, ["server.prepare"]));
      await teams.updateMemberRole(admin, ownerMembership.id, "member");
      const demoted = (await keys.findApiKey(full.token))!;
      assert.equal(demoted.actor.kind, "personal-key");
      if (demoted.actor.kind === "personal-key") {
        assert.equal(demoted.actor.policy.permissionMode, "scoped");
        assert.equal(demoted.actor.policy.includeAdmin, false);
      }
      assert(!actorAllows(demoted.actor, ["server.collectLogs"]));
      assert(actorAllows(demoted.actor, ["secret.update"]));
      await assert.rejects(
        authorizeQueuedEffect(reference, admin.workspaceId, [
          "server.collectLogs",
        ]),
      );
      await teams.updateMemberRole(admin, ownerMembership.id, "admin");
      assert(
        !actorAllows((await keys.findApiKey(full.token))!.actor, [
          "server.collectLogs",
        ]),
      );
      await assert.rejects(
        authorizeQueuedEffect(reference, admin.workspaceId, [
          "server.collectLogs",
        ]),
      );
      assert(
        actorAllows((await keys.findApiKey(teamToken))!.actor, [
          "server.collectLogs",
        ]),
      );

      const replacement = await keys.createApiKey(owner, {
        name: "Replacement full",
        access: "edit",
        includeAdmin: true,
      });
      assert(replacement.token);
      assert(
        actorAllows((await keys.findApiKey(replacement.token))!.actor, [
          "server.collectLogs",
        ]),
      );
      await db
        .update(users)
        .set({ disabledAt: new Date() })
        .where(eq(users.id, owner.id));
      assert.equal(await keys.findApiKey(full.token), null);
      assert.equal(await keys.findApiKey(replacement.token), null);
      assert(await keys.findApiKey(teamToken));
      await db
        .update(users)
        .set({ disabledAt: null })
        .where(eq(users.id, owner.id));
      await teams.removeTeamMember(admin, ownerMembership.id);
      assert.equal(await keys.findApiKey(full.token), null);
      assert.equal(await keys.findApiKey(replacement.token), null);
      assert(
        actorAllows((await keys.findApiKey(teamToken))!.actor, [
          "server.collectLogs",
        ]),
      );
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(users).where(eq(users.id, owner.id));
      await db.delete(users).where(eq(users.id, admin.id));
      await closeDatabase();
    }
  },
);
