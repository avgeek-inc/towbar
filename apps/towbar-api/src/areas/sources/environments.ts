import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  resolveRepositoryEnvironment,
  sourceEnvironmentMappingSchema,
} from "@workspace/towbar-core";
import {
  auditEvents,
  githubInstallations,
  sourceEnvironments,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";
import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueSourceSync } from "../../infrastructure/temporal.js";
import { fetchGitHubEnvironmentSnapshot } from "../github/environment-snapshot.js";

export async function sourceRepository(sourceId: string, workspaceId: string) {
  const [source] = await getTowbarDatabase()
    .select({
      id: sources.id,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      installationId: githubInstallations.installationId,
    })
    .from(sources)
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  return source;
}

export async function listSourceEnvironments(
  sourceId: string,
  workspaceId: string,
) {
  await sourceRepository(sourceId, workspaceId);
  const database = getTowbarDatabase();
  const environments = await database
    .select()
    .from(sourceEnvironments)
    .where(eq(sourceEnvironments.sourceId, sourceId))
    .orderBy(sourceEnvironments.name);
  const attempts = await database
    .selectDistinctOn([sourceSyncs.sourceEnvironmentId], {
      environmentId: sourceSyncs.sourceEnvironmentId,
      status: sourceSyncs.status,
      finishedAt: sourceSyncs.finishedAt,
      issues: sourceSyncs.issues,
    })
    .from(sourceSyncs)
    .where(eq(sourceSyncs.sourceId, sourceId))
    .orderBy(
      sourceSyncs.sourceEnvironmentId,
      desc(sourceSyncs.createdAt),
      desc(sourceSyncs.id),
    );
  return environments.map((environment) => {
    const attempt = attempts.find(
      (item) => item.environmentId === environment.id,
    );
    return {
      ...environment,
      latestSyncStatus: attempt?.status ?? "never",
      latestSyncFinishedAt: attempt?.finishedAt ?? null,
      latestSyncIssues: attempt?.issues ?? [],
    };
  });
}

export async function connectSourceEnvironment(input: {
  sourceId: string;
  workspaceId: string;
  environment: string;
  branch: string;
  actorUserId: string;
}) {
  const mapping = sourceEnvironmentMappingSchema.parse({
    environment: input.environment,
    branch: input.branch,
  });
  const source = await sourceRepository(input.sourceId, input.workspaceId);
  const snapshot = await fetchGitHubEnvironmentSnapshot({
    ...source,
    branch: mapping.branch,
  });
  const resolved = resolveRepositoryEnvironment({ ...snapshot, ...mapping });
  return getTowbarDatabase().transaction(async (transaction) => {
    const [existing] = await transaction
      .select()
      .from(sourceEnvironments)
      .where(
        and(
          eq(sourceEnvironments.sourceId, source.id),
          eq(sourceEnvironments.name, mapping.environment),
        ),
      )
      .for("update");
    if (existing && !existing.disconnectedAt)
      throw conflict(
        "This environment is already connected",
        "ENVIRONMENT_ALREADY_CONNECTED",
      );
    const values = {
      sourceId: source.id,
      name: mapping.environment,
      branch: mapping.branch,
      previewsEnabled: resolved.manifest.previewsEnabled,
      mappingRevision: randomUUID(),
      disconnectedAt: null,
      autoDeployPaused: false,
      updatedAt: new Date(),
    };
    const [environment] = existing
      ? await transaction
          .update(sourceEnvironments)
          .set(values)
          .where(eq(sourceEnvironments.id, existing.id))
          .returning()
      : await transaction.insert(sourceEnvironments).values(values).returning();
    if (!environment) throw new Error("Unable to connect environment");
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "source.environment.connected",
      targetType: "source",
      targetId: source.id,
      metadata: { environment: mapping.environment, branch: mapping.branch },
    });
    return environment;
  });
}

export async function updateEnvironmentBranch(input: {
  sourceId: string;
  environmentId: string;
  workspaceId: string;
  branch: string;
  expectedRevision: string;
  actorUserId: string;
}) {
  const source = await sourceRepository(input.sourceId, input.workspaceId);
  const [environment] = await getTowbarDatabase()
    .select()
    .from(sourceEnvironments)
    .where(
      and(
        eq(sourceEnvironments.id, input.environmentId),
        eq(sourceEnvironments.sourceId, source.id),
        isNull(sourceEnvironments.disconnectedAt),
      ),
    );
  if (!environment) throw notFound("Environment");
  const mapping = sourceEnvironmentMappingSchema.parse({
    environment: environment.name,
    branch: input.branch,
  });
  const snapshot = await fetchGitHubEnvironmentSnapshot({
    ...source,
    branch: mapping.branch,
  });
  resolveRepositoryEnvironment({ ...snapshot, ...mapping });
  return getTowbarDatabase().transaction(async (transaction) => {
    const [updated] = await transaction
      .update(sourceEnvironments)
      .set({
        branch: mapping.branch,
        mappingRevision: randomUUID(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sourceEnvironments.id, environment.id),
          eq(sourceEnvironments.mappingRevision, input.expectedRevision),
          isNull(sourceEnvironments.disconnectedAt),
        ),
      )
      .returning();
    if (!updated)
      throw conflict(
        "The environment mapping changed. Refresh before saving.",
        "ENVIRONMENT_MAPPING_CHANGED",
      );
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "source.environment.branch_updated",
      targetType: "source",
      targetId: source.id,
      metadata: {
        environment: environment.name,
        previousBranch: environment.branch,
        branch: mapping.branch,
      },
    });
    return updated;
  });
}

export async function requestEnvironmentSync(input: {
  sourceId: string;
  environmentId: string;
  workspaceId: string;
  requestedBy: string | null;
  deployAfterSync: boolean;
}) {
  await sourceRepository(input.sourceId, input.workspaceId);
  const sync = await getTowbarDatabase().transaction(async (transaction) => {
    const [environment] = await transaction
      .select()
      .from(sourceEnvironments)
      .where(
        and(
          eq(sourceEnvironments.id, input.environmentId),
          eq(sourceEnvironments.sourceId, input.sourceId),
          isNull(sourceEnvironments.disconnectedAt),
        ),
      )
      .for("update");
    if (!environment) throw notFound("Environment");
    const [row] = await transaction
      .insert(sourceSyncs)
      .values({
        sourceId: input.sourceId,
        sourceEnvironmentId: environment.id,
        mappingRevision: environment.mappingRevision,
        requestedBy: input.requestedBy,
        deployAfterSync: input.deployAfterSync,
      })
      .returning();
    if (!row) throw new Error("Unable to queue environment sync");
    return row;
  });
  try {
    await enqueueSourceSync({ sourceId: input.sourceId, syncId: sync.id });
  } catch (error) {
    await getTowbarDatabase()
      .update(sourceSyncs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        issues: [
          {
            message: "Unable to enqueue sync. Retry the environment sync.",
            path: [],
          },
        ],
      })
      .where(eq(sourceSyncs.id, sync.id));
    throw error;
  }
  return sync;
}

export async function disconnectSourceEnvironment(input: {
  sourceId: string;
  environmentId: string;
  workspaceId: string;
  expectedRevision: string;
  actorUserId: string;
}) {
  await sourceRepository(input.sourceId, input.workspaceId);
  return getTowbarDatabase().transaction(async (transaction) => {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.environmentId}, 0))`,
    );
    const [environment] = await transaction
      .update(sourceEnvironments)
      .set({
        disconnectedAt: new Date(),
        mappingRevision: randomUUID(),
        autoDeployPaused: true,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sourceEnvironments.id, input.environmentId),
          eq(sourceEnvironments.sourceId, input.sourceId),
          eq(sourceEnvironments.mappingRevision, input.expectedRevision),
          isNull(sourceEnvironments.disconnectedAt),
        ),
      )
      .returning();
    if (!environment)
      throw conflict(
        "The environment mapping changed. Refresh before disconnecting.",
        "ENVIRONMENT_MAPPING_CHANGED",
      );
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "source.environment.disconnected",
      targetType: "source",
      targetId: input.sourceId,
      metadata: { environment: environment.name },
    });
    return environment;
  });
}

export async function getEnvironmentManifest(input: {
  sourceId: string;
  environmentId: string;
  workspaceId: string;
}) {
  await sourceRepository(input.sourceId, input.workspaceId);
  const [environment] = await getTowbarDatabase()
    .select()
    .from(sourceEnvironments)
    .where(
      and(
        eq(sourceEnvironments.id, input.environmentId),
        eq(sourceEnvironments.sourceId, input.sourceId),
      ),
    );
  if (!environment) throw notFound("Environment");
  if (!environment.latestSuccessfulSyncId) return null;
  const [sync] = await getTowbarDatabase()
    .select({
      commitSha: sourceSyncs.commitSha,
      rawManifest: sourceSyncs.rawManifest,
    })
    .from(sourceSyncs)
    .where(
      and(
        eq(sourceSyncs.id, environment.latestSuccessfulSyncId),
        eq(sourceSyncs.sourceEnvironmentId, environment.id),
      ),
    );
  if (!sync?.rawManifest) return null;
  const snapshot = JSON.parse(sync.rawManifest) as {
    root: string;
    files: { path: string; content: string }[];
  };
  return {
    commitSha: sync.commitSha,
    files: [{ path: "towbar.yml", content: snapshot.root }, ...snapshot.files],
  };
}
