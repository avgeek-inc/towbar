import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  integrationInstallations,
  sourceEnvironments,
  sources,
  workspaces,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { requestEnvironmentSync } from "./environments.js";
import { processGitHubPush } from "../github/webhooks.js";

export async function assertEnvironmentPushRouting() {
  const database = getTowbarDatabase();
  const workspaceId = randomUUID();
  await database
    .insert(workspaces)
    .values({ id: workspaceId, slug: workspaceId, name: "Webhook test" });
  const installationId = randomInt(1, 2_000_000_000);
  const [installation] = await database
    .insert(integrationInstallations)
    .values({
      provider: "github",
      workspaceId,
      externalId: String(installationId),
      principalName: "push-test",
      principalType: "Organization",
    })
    .returning();
  const sourceId = randomUUID();
  try {
    await database.insert(sources).values({
      id: sourceId,
      workspaceId,
      integrationInstallationId: installation!.id,
      repositoryOwner: "push-test",
      repositoryName: "example",
    });
    const [production, staging] = await database
      .insert(sourceEnvironments)
      .values([
        { sourceId, name: "production", branch: "main" },
        { sourceId, name: "staging", branch: "develop" },
      ])
      .returning();
    await assert.rejects(
      requestEnvironmentSync({
        sourceId,
        workspaceId,
        environmentId: staging!.id,
        requestedBy: null,
        deployAfterSync: true,
        expectedMappingRevision: randomUUID(),
      }),
      /mapping changed/,
    );
    const queued: string[] = [];
    const push = async (branch: string, deleted = false) => {
      queued.length = 0;
      await processGitHubPush(
        {
          after: "a".repeat(40),
          deleted,
          ref: `refs/heads/${branch}`,
          installation: { id: installationId },
          repository: { name: "example", owner: { login: "push-test" } },
        },
        (input) => {
          assert.equal(input.workspaceId, workspaceId);
          assert.equal(input.sourceId, sourceId);
          assert.equal(input.deployAfterSync, true);
          assert.equal(
            input.expectedMappingRevision,
            input.environmentId === production!.id
              ? production!.mappingRevision
              : staging!.mappingRevision,
          );
          queued.push(input.environmentId);
          return Promise.resolve();
        },
      );
      return [...queued];
    };
    assert.deepEqual(await push("main"), [production!.id]);
    assert.deepEqual(await push("develop"), [staging!.id]);
    assert.deepEqual(await push("other"), []);
    assert.deepEqual(await push("main", true), []);
    await database
      .update(sourceEnvironments)
      .set({ branch: "release/staging" })
      .where(eq(sourceEnvironments.id, staging!.id));
    assert.deepEqual(await push("develop"), []);
    assert.deepEqual(await push("release/staging"), [staging!.id]);
    await database
      .update(integrationInstallations)
      .set({ suspendedAt: new Date() })
      .where(eq(integrationInstallations.id, installation!.id));
    assert.deepEqual(await push("main"), []);
    await database
      .update(integrationInstallations)
      .set({ suspendedAt: null })
      .where(eq(integrationInstallations.id, installation!.id));
    await database
      .update(sourceEnvironments)
      .set({ disconnectedAt: new Date() })
      .where(eq(sourceEnvironments.sourceId, sourceId));
    assert.deepEqual(await push("main"), []);
    assert.deepEqual(await push("release/staging"), []);
    await database
      .delete(sourceEnvironments)
      .where(eq(sourceEnvironments.sourceId, sourceId));
    assert.deepEqual(await push("main"), []);
  } finally {
    await database.delete(sources).where(eq(sources.id, sourceId));
    await database
      .delete(integrationInstallations)
      .where(eq(integrationInstallations.id, installation!.id));
    await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
  }
}
