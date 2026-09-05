import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  type MonitoringSample,
  aggregateMonitoringValues,
} from "@workspace/towbar-core";
import {
  deployments,
  monitoringAgents,
  monitoringBatches,
  monitoringSamples,
  serverDeployableOwnership,
  servers,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { HttpError, badRequest, unauthorized } from "../../http/errors.js";

export function hashAgentToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function matchesAgentToken(token: string, hash: string | null) {
  return Boolean(
    hash &&
    /^[a-f0-9]{64}$/u.test(hash) &&
    timingSafeEqual(
      Buffer.from(hashAgentToken(token), "hex"),
      Buffer.from(hash, "hex"),
    ),
  );
}
export async function authenticateAgent(serverId: string, token: string) {
  const [agent] = await getTowbarDatabase()
    .select({ agent: monitoringAgents })
    .from(monitoringAgents)
    .innerJoin(servers, eq(servers.id, monitoringAgents.serverId))
    .where(and(eq(servers.id, serverId), isNull(servers.archivedAt)))
    .limit(1);
  if (
    !agent ||
    agent.agent.desiredState !== "enabled" ||
    !matchesAgentToken(token, agent.agent.tokenHash)
  )
    throw unauthorized("Invalid monitoring credential");
  return agent.agent.generation;
}
export function validateSampleTime(collectedAt: string, now: Date) {
  const age = now.getTime() - new Date(collectedAt).getTime();
  if (!Number.isFinite(age) || age < -120_000 || age > 2 * 3600_000)
    throw badRequest(
      "Metrics must be collected within the last two hours, with at most two minutes of clock skew",
    );
}
export async function ingestMonitoringSample(
  serverId: string,
  generation: string,
  sample: MonitoringSample,
  now = new Date(),
) {
  validateSampleTime(sample.collectedAt, now);
  const database = getTowbarDatabase();
  return database.transaction(async (transaction) => {
    // Server lock serializes ingestion with server removal; generation protects rotation/uninstall races.
    const [server] = await transaction
      .select({ id: servers.id })
      .from(servers)
      .where(and(eq(servers.id, serverId), isNull(servers.archivedAt)))
      .for("share")
      .limit(1);
    if (!server) throw unauthorized("Monitoring registration is inactive");
    const [agent] = await transaction
      .select()
      .from(monitoringAgents)
      .where(eq(monitoringAgents.serverId, serverId))
      .for("update")
      .limit(1);
    if (
      !agent ||
      agent.generation !== generation ||
      agent.desiredState !== "enabled" ||
      !agent.tokenHash
    )
      throw unauthorized("Monitoring registration is inactive");
    const window = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
    const count =
      agent.ingestWindow?.getTime() === window.getTime()
        ? agent.ingestCount
        : 0;
    if (count >= 120)
      throw new HttpError(
        429,
        "MONITORING_RATE_LIMITED",
        "Monitoring upload limit exceeded",
        { responseHeaders: { "Retry-After": "60" } },
      );
    const [batch] = await transaction
      .insert(monitoringBatches)
      .values({ serverId, sampleId: sample.id, receivedAt: now })
      .onConflictDoNothing()
      .returning({ id: monitoringBatches.sampleId });
    if (!batch) return { accepted: 0, replayed: true };
    const claimedIds = sample.entities.flatMap((entity) =>
      entity.deployableId ? [entity.deployableId] : [],
    );
    const ownership = claimedIds.length
      ? await transaction
          .select()
          .from(serverDeployableOwnership)
          .where(
            and(
              eq(serverDeployableOwnership.serverId, serverId),
              inArray(serverDeployableOwnership.deployableId, claimedIds),
            ),
          )
      : [];
    const owned = new Set(ownership.map((row) => row.deployableId));
    const deploymentIds = sample.entities.flatMap((entity) =>
      entity.deploymentId ? [entity.deploymentId] : [],
    );
    const knownDeployments = deploymentIds.length
      ? await transaction
          .select({
            id: deployments.id,
            appId: deployments.appId,
            previewId: deployments.previewEnvironmentId,
          })
          .from(deployments)
          .where(
            and(
              eq(deployments.serverId, serverId),
              inArray(deployments.id, deploymentIds),
            ),
          )
      : [];
    const deploymentById = new Map(
      knownDeployments.map((row) => [row.id, row]),
    );
    const bucketAt = new Date(
      Math.floor(new Date(sample.collectedAt).getTime() / 30_000) * 30_000,
    );
    const rows = sample.entities.flatMap((entity) => {
      if (entity.id !== "host" && !owned.has(entity.deployableId!)) return [];
      const deployment = entity.deploymentId
        ? deploymentById.get(entity.deploymentId)
        : undefined;
      if (
        entity.deploymentId &&
        (!deployment || deployment.appId !== entity.deployableId)
      )
        return [];
      return [
        {
          serverId,
          entityId: entity.id,
          bucketAt,
          resolution: 30,
          deployableId: entity.deployableId ?? null,
          deploymentId: deployment?.id ?? null,
          previewId: deployment?.previewId ?? null,
          state: entity.state ?? null,
          health: entity.health ?? null,
          metrics: aggregateMonitoringValues(entity.metrics),
        },
      ];
    });
    // Bound stored identities per collection slot even if a damaged sender changes IDs on every retry.
    const existing = await transaction
      .select({ id: monitoringSamples.entityId })
      .from(monitoringSamples)
      .where(
        and(
          eq(monitoringSamples.serverId, serverId),
          eq(monitoringSamples.bucketAt, bucketAt),
          eq(monitoringSamples.resolution, 30),
        ),
      );
    const existingIds = new Set(existing.map((row) => row.id));
    const newRows = rows
      .filter((row) => !existingIds.has(row.entityId))
      .sort(
        (a, b) => Number(b.entityId === "host") - Number(a.entityId === "host"),
      )
      .slice(0, Math.max(0, 513 - existing.length));
    const inserted = newRows.length
      ? await transaction
          .insert(monitoringSamples)
          .values(newRows)
          .onConflictDoNothing()
          .returning({ id: monitoringSamples.entityId })
      : [];
    const newest =
      !agent.lastCollectedAt ||
      new Date(sample.collectedAt) > agent.lastCollectedAt;
    await transaction
      .update(monitoringAgents)
      .set({
        lastReportAt: now,
        ingestWindow: window,
        ingestCount: count + 1,
        ...(newest
          ? {
              lastCollectedAt: new Date(sample.collectedAt),
              installedVersion: sample.version,
              diagnostics: {
                collectionDurationMs: sample.collectionDurationMs,
                collectionErrors: sample.collectionErrors,
                droppedSamples: sample.droppedSamples,
              },
            }
          : {}),
        status: sql`case when ${monitoringAgents.status} in ('waiting','online') then 'online' else ${monitoringAgents.status} end`,
      })
      .where(eq(monitoringAgents.serverId, serverId));
    return { accepted: inserted.length, replayed: false };
  });
}
