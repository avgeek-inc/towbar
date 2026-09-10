import { assertEnvironmentSyncReporting } from "./environment-status-tests.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { apps } from "@workspace/towbar-database/schema";
import { sourceSyncs } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  executeSourceSync,
  getSourceSync,
  listSourceSyncs,
} from "./service.js";
import { assertEnvironmentPushRouting } from "./environment-webhook-tests.js";
import {
  getApp,
  getResource,
  listApps,
  listResources,
} from "../apps/queries.js";

export async function assertInstanceQueryIdentity({
  workspaceId,
  sourceId,
  prod,
  stage,
}: {
  workspaceId: string;
  sourceId: string;
  prod: typeof apps.$inferSelect;
  stage: typeof apps.$inferSelect;
}) {
  await assertEnvironmentSyncReporting(sourceId, workspaceId);
  await assertEnvironmentPushRouting();
  const { assertEnvironmentOwnership } =
    await import("./environment-ownership-tests.js");
  await assertEnvironmentOwnership(stage);
  const database = getTowbarDatabase();
  const [unscoped] = await database
    .insert(sourceSyncs)
    .values({ sourceId })
    .returning();
  await assert.rejects(
    executeSourceSync(unscoped!.id),
    /requires an environment/,
  );
  const [rejected] = await database
    .select()
    .from(sourceSyncs)
    .where(eq(sourceSyncs.id, unscoped!.id));
  assert.equal(rejected!.status, "failed");
  assert(rejected?.issues);
  assert.match(rejected.issues[0]!.message, /requires an environment/);
  await database.delete(sourceSyncs).where(eq(sourceSyncs.id, unscoped!.id));
  const history = await listSourceSyncs(sourceId, workspaceId);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((sync) => sync.environment?.name).sort(), [
    "production",
    "staging",
  ]);
  for (const sync of history) {
    assert(sync.mappingRevision);
    assert.deepEqual(await getSourceSync(sourceId, sync.id, workspaceId), sync);
    await assert.rejects(
      getSourceSync(sourceId, sync.id, randomUUID()),
      /not found/i,
    );
  }
  for (const column of [
    "entity_id",
    "source_environment_id",
    "required_secrets",
  ]) {
    await assert.rejects(
      database.execute(
        sql`update towbar_apps set ${sql.identifier(column)} = null where id = ${stage.id}`,
      ),
      (error: unknown) =>
        (error as { cause?: { code?: string } }).cause?.code === "23502",
    );
  }
  const instances = await listApps(workspaceId, sourceId);
  assert.equal(instances.length, 2);
  for (const [record, name] of [
    [prod, "production"],
    [stage, "staging"],
  ] as const) {
    const detail = await getApp(record.id, workspaceId);
    const listed = instances.find((instance) => instance.id === record.id)!;
    assert.equal(detail.entityId, prod.entityId);
    assert.equal(detail.environment?.id, record.sourceEnvironmentId);
    assert.equal(detail.environment?.name, name);
    assert.equal(detail.environment?.disconnectedAt, null);
    assert.deepEqual(listed.environment, detail.environment);
    assert.equal(listed.entityId, detail.entityId);
  }
  assert.deepEqual(await listApps(randomUUID(), sourceId), []);
  await assert.rejects(getApp(stage.id, randomUUID()), /not found/i);
  assert.deepEqual(await listResources(workspaceId, sourceId), []);
  await assert.rejects(getResource(stage.id, workspaceId), /not found/i);
}
