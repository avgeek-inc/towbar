import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  apps,
  deployments,
  domainClaims,
  releases,
  sourceEnvironments,
} from "@workspace/towbar-database/schema";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  lockDomainClaims,
  reserveDeploymentDomains,
  synchronizeDomainClaims,
} from "./domain-claims.js";

export async function assertUnrelatedLegacyDomains(input: {
  database: ReturnType<typeof getTowbarDatabase>;
  instances: Array<typeof apps.$inferSelect>;
  deploymentId: string;
  sync: () => Promise<unknown>;
}) {
  const { database, instances, deploymentId, sync } = input;
  const template = instances[0]!;
  const [deployment] = await database
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId));
  assert(deployment);
  const [environment] = await database
    .insert(sourceEnvironments)
    .values({ sourceId: template.sourceId, name: "legacy", branch: "legacy" })
    .returning();
  assert(environment);
  const ids: string[] = [],
    deploymentIds: string[] = [];
  const hostname = "ambiguous-ingestion.example.com";
  try {
    for (const original of instances) {
      const id = randomUUID(),
        deploymentId = randomUUID();
      ids.push(id);
      deploymentIds.push(deploymentId);
      const config = { ...original.config, domains: undefined };
      await database.insert(apps).values({
        ...original,
        id,
        sourceEnvironmentId: environment.id,
        config,
      });
      await database.insert(deployments).values({
        ...deployment,
        id: deploymentId,
        appId: id,
        idempotencyKey: randomUUID(),
        temporalWorkflowId: `fixture-domain-${deploymentId}`,
        targetEnvironment: {
          ...deployment.targetEnvironment,
          id: environment.id,
        },
        appSnapshot: {
          ...config,
          domains: { primary: hostname, redirects: [] },
        },
        state: "succeeded",
      });
      await database.insert(releases).values({
        appId: id,
        deploymentId,
        status: "current",
        environment: "production",
        commitSha: "a".repeat(40),
        imageTag: "fixture:legacy",
        containerName: "fixture-legacy-" + id,
      });
    }
    await sync();
    await database.transaction(async (transaction) => {
      await lockDomainClaims(transaction, template.workspaceId);
      await reserveDeploymentDomains(transaction, deployment);
    });
    assert.deepEqual(
      await database
        .select()
        .from(domainClaims)
        .where(
          and(
            eq(domainClaims.workspaceId, template.workspaceId),
            eq(domainClaims.hostname, hostname),
          ),
        ),
      [],
      "unrelated ambiguous owners are not assigned a guessed claim",
    );
    await assert.rejects(
      database.transaction(async (transaction) => {
        await lockDomainClaims(transaction, template.workspaceId);
        await synchronizeDomainClaims(transaction, template.workspaceId, {
          sourceEnvironmentId: environment.id,
        });
      }),
      /multiple deployed owners/,
      "the owning environment still blocks on ambiguous provenance",
    );
    const [target] = await database
      .select()
      .from(apps)
      .where(eq(apps.id, template.id));
    assert(target);
    await database
      .update(apps)
      .set({
        config: {
          ...target.config,
          domains: { primary: hostname, redirects: [] },
        },
      })
      .where(eq(apps.id, target.id));
    await assert.rejects(
      database.transaction(async (transaction) => {
        await lockDomainClaims(transaction, template.workspaceId);
        await synchronizeDomainClaims(transaction, template.workspaceId, {
          sourceEnvironmentId: template.sourceEnvironmentId,
        });
      }),
      /multiple deployed owners/,
      "a different environment cannot claim the ambiguous hostname",
    );
    await database
      .update(apps)
      .set({ config: target.config })
      .where(eq(apps.id, target.id));
  } finally {
    await database
      .delete(domainClaims)
      .where(eq(domainClaims.sourceEnvironmentId, environment.id));
    await database
      .delete(releases)
      .where(inArray(releases.deploymentId, deploymentIds));
    await database
      .delete(deployments)
      .where(inArray(deployments.id, deploymentIds));
    await database.delete(apps).where(inArray(apps.id, ids));
    await database
      .delete(sourceEnvironments)
      .where(eq(sourceEnvironments.id, environment.id));
  }
}
