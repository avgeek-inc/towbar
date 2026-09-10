import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  apps,
  servers,
  sourceEntities,
  sourceEnvironments,
  sourceSyncs,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function assertEnvironmentOwnership(
  instance: typeof apps.$inferSelect,
) {
  const db = getTowbarDatabase();
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, instance.sourceId));
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, instance.serverId));
  assert(source && server);
  const otherSourceId = randomUUID(),
    otherWorkspaceId = randomUUID();
  const rejectsForeignKey = async (
    operation: PromiseLike<unknown>,
    constraint: string,
  ) => {
    await assert.rejects(Promise.resolve(operation), (error: unknown) => {
      const failure = error as {
        cause?: { code?: string; constraint_name?: string };
      };
      return (
        failure.cause?.code === "23503" &&
        failure.cause.constraint_name === constraint
      );
    });
  };
  await db
    .insert(workspaces)
    .values({
      id: otherWorkspaceId,
      name: "Ownership test",
      slug: otherWorkspaceId,
    });
  try {
    await db
      .insert(sources)
      .values({ ...source, id: otherSourceId, repositoryName: otherSourceId });
    const [environment] = await db
      .insert(sourceEnvironments)
      .values({ sourceId: otherSourceId, name: "production", branch: "main" })
      .returning();
    const [entity] = await db
      .insert(sourceEntities)
      .values({
        sourceId: otherSourceId,
        entityType: "app",
        manifestId: "site",
      })
      .returning();
    const [otherServer] = await db
      .insert(servers)
      .values({
        id: randomUUID(),
        workspaceId: otherWorkspaceId,
        canonicalIp: server.canonicalIp,
        config: server.config,
        configDigest: server.configDigest,
        slug: "other-host",
      })
      .returning();
    await rejectsForeignKey(
      db
        .update(apps)
        .set({ sourceEnvironmentId: environment!.id })
        .where(eq(apps.id, instance.id)),
      "fk_towbar_apps_environment_owner",
    );
    await rejectsForeignKey(
      db
        .update(apps)
        .set({ entityId: entity!.id })
        .where(eq(apps.id, instance.id)),
      "fk_towbar_apps_entity_owner",
    );
    await rejectsForeignKey(
      db
        .update(apps)
        .set({ serverId: otherServer!.id })
        .where(eq(apps.id, instance.id)),
      "fk_towbar_apps_server_owner",
    );
    await rejectsForeignKey(
      db
        .insert(sourceSyncs)
        .values({ sourceId: source.id, sourceEnvironmentId: environment!.id }),
      "fk_towbar_source_syncs_environment_owner",
    );
    await rejectsForeignKey(
      db.insert(apps).values({
        ...instance,
        id: randomUUID(),
        workspaceId: otherWorkspaceId,
        serverId: otherServer!.id,
        entityId: null,
        sourceEnvironmentId: null,
      }),
      "fk_towbar_apps_source_owner",
    );
  } finally {
    await db.delete(sources).where(eq(sources.id, otherSourceId));
    await db.delete(workspaces).where(eq(workspaces.id, otherWorkspaceId));
  }
}
