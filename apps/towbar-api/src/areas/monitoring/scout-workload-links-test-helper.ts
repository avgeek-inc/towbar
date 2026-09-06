import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  aggregateMonitoringValues,
  normalizeDeploymentManifest,
  scoutAlertRuleSchema,
} from "@workspace/towbar-core";
import {
  apps,
  githubInstallations,
  monitoringSamples,
  notificationEvents,
  sources,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { type ScoutScope, saveScoutAlertRule } from "./alert-rules.js";

export async function assertScoutWorkloadLinks(
  scope: ScoutScope & { requestedBy: string },
  sweep: (at: Date) => Promise<unknown>,
) {
  const db = getTowbarDatabase();
  const sourceId = randomUUID();
  const [installation] = await db
    .insert(githubInstallations)
    .values({
      workspaceId: scope.workspaceId,
      installationId: randomUUID(),
      accountLogin: "example",
      accountType: "Organization",
    })
    .returning();
  await db.insert(sources).values({
    id: sourceId,
    workspaceId: scope.workspaceId,
    githubInstallationId: installation!.id,
    repositoryOwner: "example",
    repositoryName: "links",
    branch: "main",
  });
  const manifest = normalizeDeploymentManifest({
    version: 1,
    apps: [
      {
        id: "app",
        name: "App",
        server: "192.0.2.10",
        dockerfile: "Dockerfile",
        context: ".",
        container: { port: 3000 },
        health: { path: "/health" },
      },
    ],
    resources: [
      {
        id: "database",
        name: "Database",
        type: "postgres",
        server: "192.0.2.10",
      },
    ],
  });
  const ids = [randomUUID(), randomUUID()];
  const now = new Date(Date.now() + 7200_000);
  for (const [index, kind] of ["app", "postgres"].entries()) {
    const id = ids[index]!;
    await db.insert(apps).values({
      id,
      kind: kind as "app" | "postgres",
      workspaceId: scope.workspaceId,
      sourceId,
      serverId: scope.serverId,
      manifestId: kind,
      name: kind,
      config: index === 0 ? manifest.apps[0]! : manifest.resources![0]!,
      configDigest: "fixture",
      sourceRevision: "abcdef0",
    });
    await saveScoutAlertRule({
      ...scope,
      rule: scoutAlertRuleSchema.parse({
        name: `Link ${kind}`,
        deployableId: id,
        condition: { metric: "memoryPercent", threshold: 80 },
      }),
    });
    await db.insert(monitoringSamples).values({
      serverId: scope.serverId,
      entityId: id,
      deployableId: id,
      bucketAt: now,
      metrics: aggregateMonitoringValues({ memoryPercent: 99 }),
    });
  }
  await sweep(now);
  const events = await db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.workspaceId, scope.workspaceId));
  for (const [index, segment] of ["apps", "resources"].entries()) {
    const id = ids[index]!;
    const event = events.find((entry) => entry.payload.entity.id === id);
    assert(event, "The workload alert should produce a notification");
    const target = new URL(String(event.payload.details.performance));
    assert.equal(target.pathname, `/sources/${sourceId}/${segment}/${id}`);
    assert.equal(target.searchParams.get("section"), "monitoring");
  }
}
