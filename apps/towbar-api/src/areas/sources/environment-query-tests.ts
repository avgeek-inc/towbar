import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertEnvironmentPushRouting } from "./environment-webhook-tests.js";
import type { apps } from "@workspace/towbar-database/schema";
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
  await assertEnvironmentPushRouting();
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
