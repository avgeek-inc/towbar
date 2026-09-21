import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  apps,
  integrationInstallations,
  servers,
  sources,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
export async function assertRemovedServerAdmission({
  workspaceId,
  prod,
  config,
  syncProduction,
  syncStaging,
}: {
  workspaceId: string;
  prod: typeof apps.$inferSelect;
  config: (typeof servers.$inferSelect)["config"];
  syncProduction: () => Promise<void>;
  syncStaging: () => Promise<void>;
}) {
  const database = getTowbarDatabase();
  const removedAt = new Date();
  await database
    .update(apps)
    .set({ archivedAt: removedAt })
    .where(eq(apps.serverId, prod.serverId));
  await database
    .update(servers)
    .set({ archivedAt: removedAt, preparedAt: null })
    .where(eq(servers.id, prod.serverId));
  await assert.rejects(syncProduction(), /Register server/);
  const [restoredServer] = await database
    .select()
    .from(servers)
    .where(eq(servers.id, prod.serverId));
  const [restoredApp] = await database
    .select()
    .from(apps)
    .where(eq(apps.id, prod.id));
  assert.equal(restoredServer?.archivedAt?.getTime(), removedAt.getTime());
  assert.equal(restoredServer?.preparedAt, null);
  assert.equal(restoredApp?.archivedAt?.getTime(), removedAt.getTime());
  const { createServer } = await import("../servers/lifecycle.js");
  await createServer({ workspaceId, config });
  await syncProduction();
  await syncStaging();
}

export async function seedEnvironmentTeam({
  workspaceId,
  userId,
  sourceId,
}: {
  workspaceId: string;
  userId: string;
  sourceId: string;
}) {
  const database = getTowbarDatabase();
  await database
    .insert(workspaces)
    .values({ id: workspaceId, slug: workspaceId, name: "V2 test" });
  await database.insert(users).values({
    id: userId,
    email: `${userId}@example.com`,
    displayName: "Test",
  });
  await database
    .insert(workspaceMembers)
    .values({ workspaceId, userId, role: "admin" });
  const [installation] = await database
    .insert(integrationInstallations)
    .values({
      provider: "github",
      workspaceId,
      externalId: randomUUID(),
      principalName: "test",
      principalType: "Organization",
    })
    .returning();
  await database.insert(sources).values({
    id: sourceId,
    workspaceId,
    integrationInstallationId: installation!.id,
    repositoryOwner: "test",
    repositoryName: "test",
  });
}
