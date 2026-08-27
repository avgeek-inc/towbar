import { randomUUID } from "node:crypto";

import { and, desc, eq, notInArray } from "drizzle-orm";

import { deploymentWorkflowId } from "@workspace/towbar-core/temporal";
import { isNormalizedResource } from "@workspace/towbar-core";
import {
  apps,
  deployments,
  releases,
  servers,
  sources,
} from "@workspace/towbar-database/schema";

import { conflict, notFound, unprocessable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueDeployment } from "../../infrastructure/temporal.js";
import { publicDeploymentSelection } from "../deployment-selection.js";
import { scopeDeploymentIdempotencyKey } from "./idempotency.js";
import { getApp, getResource } from "./queries.js";

export { getApp, getResource, listApps, listResources } from "./queries.js";

export async function listAppDeployments(appId: string, workspaceId: string) {
  await getApp(appId, workspaceId);
  return await getTowbarDatabase()
    .select(publicDeploymentSelection)
    .from(deployments)
    .where(eq(deployments.appId, appId))
    .orderBy(desc(deployments.createdAt));
}

export async function listAppReleases(appId: string, workspaceId: string) {
  await getApp(appId, workspaceId);
  return await getTowbarDatabase()
    .select()
    .from(releases)
    .where(eq(releases.appId, appId))
    .orderBy(desc(releases.promotedAt));
}

export async function listResourceDeployments(
  resourceId: string,
  workspaceId: string,
) {
  await getResource(resourceId, workspaceId);
  return await getTowbarDatabase()
    .select(publicDeploymentSelection)
    .from(deployments)
    .where(eq(deployments.appId, resourceId))
    .orderBy(desc(deployments.createdAt));
}

export async function listResourceReleases(
  resourceId: string,
  workspaceId: string,
) {
  await getResource(resourceId, workspaceId);
  return await getTowbarDatabase()
    .select()
    .from(releases)
    .where(eq(releases.appId, resourceId))
    .orderBy(desc(releases.promotedAt));
}

export async function requestAppDeployment(input: {
  appId: string;
  expectedCommitSha?: string;
  idempotencyKey: string;
  requestedBy: string | null;
  workspaceId: string;
  expectedType?: "app" | "resource";
}) {
  const request = {
    ...input,
    idempotencyKey: scopeDeploymentIdempotencyKey("deploy", input),
  };
  const database = getTowbarDatabase();
  const existing = await findIdempotentDeployment(request);
  if (existing) return { deployment: existing, replayed: true };

  const target = await getAppForDeployment(request.appId, request.workspaceId);
  requireDeployableType(target.config, request.expectedType ?? "app");
  if (target.archivedAt) {
    throw conflict("Archived apps cannot be deployed");
  }
  if (!target.commitSha || !target.deploymentDigest || !target.manifestDigest) {
    throw unprocessable("The Source must have a successful sync before deploy");
  }
  requireServerReady(target);
  const commitSha = target.commitSha;
  const deploymentDigest = target.deploymentDigest;
  const manifestDigest = target.manifestDigest;
  if (request.expectedCommitSha && commitSha !== request.expectedCommitSha) {
    throw conflict(
      "A newer Source revision is already available",
      "SOURCE_REVISION_SUPERSEDED",
    );
  }
  const deploymentId = randomUUID();
  let admission;
  try {
    admission = await database.transaction(async (transaction) => {
      const [currentApp] = await transaction
        .select({
          deploymentDigest: apps.deploymentDigest,
          id: apps.id,
          serverConfigDigest: servers.configDigest,
          serverPreparedAt: servers.preparedAt,
          serverPreparedConfigDigest: servers.preparedConfigDigest,
          sourceRevision: apps.sourceRevision,
        })
        .from(apps)
        .innerJoin(servers, eq(servers.id, apps.serverId))
        .where(
          and(
            eq(apps.id, target.id),
            eq(apps.workspaceId, request.workspaceId),
          ),
        )
        .for("update");
      if (!currentApp) throw notFound("App");
      requireServerReady(currentApp);
      if (
        currentApp.sourceRevision !== commitSha ||
        currentApp.deploymentDigest !== deploymentDigest
      ) {
        throw conflict(
          "A newer Source revision is already available",
          "SOURCE_REVISION_SUPERSEDED",
        );
      }
      if (!request.requestedBy) {
        const [sameDeployment] = await transaction
          .select({ id: deployments.id })
          .from(deployments)
          .where(
            and(
              eq(deployments.appId, target.id),
              eq(deployments.deploymentDigest, deploymentDigest),
              notInArray(deployments.state, [
                "cancelled",
                "failed",
                "skipped",
                "succeeded",
                "succeeded_with_warnings",
              ]),
            ),
          )
          .orderBy(desc(deployments.createdAt))
          .limit(1);
        if (sameDeployment) {
          return { deploymentId: sameDeployment.id, replayed: true };
        }
      }
      const now = new Date();
      await transaction
        .update(deployments)
        .set({
          errorCode: "DEPLOYMENT_SUPERSEDED",
          errorMessage: "Superseded by a newer deployment request",
          finishedAt: now,
          state: "skipped",
          updatedAt: now,
        })
        .where(
          and(
            eq(deployments.appId, target.id),
            eq(deployments.state, "queued"),
          ),
        );
      const deploymentValues: typeof deployments.$inferInsert = {
        appId: target.id,
        appSnapshot: target.config,
        commitSha,
        configDigest: target.configDigest,
        deploymentDigest,
        deployableKind: target.kind,
        id: deploymentId,
        idempotencyKey: request.idempotencyKey,
        manifestDigest,
        requestedBy: request.requestedBy,
        serverId: target.serverId,
        serverSnapshot: target.serverConfig,
        sourceId: target.sourceId,
        sourceInputDigest: target.sourceInputDigest,
        temporalWorkflowId: deploymentWorkflowId(deploymentId),
        workspaceId: request.workspaceId,
      };
      const [created] = await transaction
        .insert(deployments)
        .values(deploymentValues)
        .returning();
      if (!created) throw new Error("Unable to admit deployment");
      return { deploymentId: created.id, replayed: false };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await findIdempotentDeployment(request);
      if (replay) return { deployment: replay, replayed: true };
    }
    throw error;
  }
  if (!admission) throw new Error("Unable to admit deployment");
  if (admission.replayed) {
    return {
      deployment: await getPublicDeployment(
        admission.deploymentId,
        request.workspaceId,
      ),
      replayed: true,
    };
  }
  try {
    await enqueueDeployment({
      appId: target.id,
      buildConcurrency: target.serverConfig.buildConcurrency ?? 1,
      deploymentId,
      serverIp: target.serverIp,
    });
  } catch (error) {
    await database
      .update(deployments)
      .set({
        errorCode: "TEMPORAL_UNAVAILABLE",
        errorMessage: "Deployment queue is unavailable",
        finishedAt: new Date(),
        state: "failed",
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));
    throw error;
  }
  return {
    deployment: await getPublicDeployment(
      admission.deploymentId,
      request.workspaceId,
    ),
    replayed: false,
  };
}

export async function requestAppRollback(input: {
  appId: string;
  idempotencyKey: string;
  releaseId?: string;
  requestedBy: string;
  workspaceId: string;
  expectedType?: "app" | "resource";
}) {
  const request = {
    ...input,
    idempotencyKey: scopeDeploymentIdempotencyKey("rollback", input),
  };
  const existing = await findIdempotentDeployment(request);
  if (existing) return { deployment: existing, replayed: true };

  const app =
    (request.expectedType ?? "app") === "resource"
      ? await getResource(request.appId, request.workspaceId)
      : await getApp(request.appId, request.workspaceId);
  if (app.archivedAt) {
    throw conflict("Archived apps cannot be rolled back");
  }
  if (!app.serverReady) {
    throw conflict(
      "Prepare this server before deploying apps or resources",
      "SERVER_SETUP_PENDING",
    );
  }
  const conditions = [
    eq(releases.appId, app.id),
    eq(releases.status, "previous"),
  ];
  if (request.releaseId) conditions.push(eq(releases.id, request.releaseId));
  const [release] = await getTowbarDatabase()
    .select()
    .from(releases)
    .where(and(...conditions))
    .orderBy(desc(releases.promotedAt))
    .limit(1);
  if (!release) throw notFound("Release");

  const [original] = await getTowbarDatabase()
    .select()
    .from(deployments)
    .where(eq(deployments.id, release.deploymentId))
    .limit(1);
  if (!original) throw notFound("Release deployment");
  const deploymentId = randomUUID();
  let deployment;
  try {
    [deployment] = await getTowbarDatabase()
      .insert(deployments)
      .values({
        appId: app.id,
        appSnapshot: original.appSnapshot,
        commitSha: original.commitSha,
        configDigest: original.configDigest,
        deploymentDigest: original.deploymentDigest,
        deployableKind: original.deployableKind,
        id: deploymentId,
        idempotencyKey: request.idempotencyKey,
        kind: "rollback",
        manifestDigest: original.manifestDigest,
        requestedBy: request.requestedBy,
        rollbackReleaseSnapshot: {
          commitSha: release.commitSha,
          containerName: release.containerName,
          imageTag: release.imageTag,
          releaseId: release.id,
          sourceDeploymentId: release.deploymentId,
        },
        serverId: original.serverId,
        serverSnapshot: original.serverSnapshot,
        sourceId: original.sourceId,
        sourceInputDigest: original.sourceInputDigest,
        temporalWorkflowId: deploymentWorkflowId(deploymentId),
        workspaceId: request.workspaceId,
      })
      .returning();
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await findIdempotentDeployment(request);
      if (replay) return { deployment: replay, replayed: true };
    }
    throw error;
  }
  if (!deployment) throw new Error("Unable to admit rollback");
  try {
    await enqueueDeployment({
      appId: deployment.appId,
      buildConcurrency: deployment.serverSnapshot.buildConcurrency ?? 1,
      deploymentId,
      serverIp: deployment.serverSnapshot.ip,
    });
  } catch (error) {
    await getTowbarDatabase()
      .update(deployments)
      .set({
        errorCode: "TEMPORAL_UNAVAILABLE",
        errorMessage: "Deployment queue is unavailable",
        finishedAt: new Date(),
        state: "failed",
        updatedAt: new Date(),
      })
      .where(eq(deployments.id, deploymentId));
    throw error;
  }
  return {
    deployment: await getPublicDeployment(deployment.id, request.workspaceId),
    replayed: false,
  };
}

export async function requestDeploymentRetry(input: {
  deploymentId: string;
  idempotencyKey: string;
  requestedBy: string;
  workspaceId: string;
}) {
  const [original] = await getTowbarDatabase()
    .select({
      appId: deployments.appId,
      appSnapshot: deployments.appSnapshot,
      kind: deployments.kind,
      rollbackReleaseSnapshot: deployments.rollbackReleaseSnapshot,
      state: deployments.state,
    })
    .from(deployments)
    .where(
      and(
        eq(deployments.id, input.deploymentId),
        eq(deployments.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!original) throw notFound("Deployment");
  if (original.state !== "failed" && original.state !== "cancelled") {
    throw conflict("Only failed or cancelled deployments can be retried");
  }

  if (original.kind === "rollback") {
    if (!original.rollbackReleaseSnapshot) {
      throw conflict("Rollback deployment is missing its release snapshot");
    }
    return await requestAppRollback({
      appId: original.appId,
      idempotencyKey: input.idempotencyKey,
      releaseId: original.rollbackReleaseSnapshot.releaseId,
      requestedBy: input.requestedBy,
      workspaceId: input.workspaceId,
      expectedType: isNormalizedResource(original.appSnapshot)
        ? "resource"
        : "app",
    });
  }

  return await requestAppDeployment({
    appId: original.appId,
    idempotencyKey: input.idempotencyKey,
    requestedBy: input.requestedBy,
    workspaceId: input.workspaceId,
    expectedType: isNormalizedResource(original.appSnapshot)
      ? "resource"
      : "app",
  });
}

async function getAppForDeployment(appId: string, workspaceId: string) {
  const [app] = await getTowbarDatabase()
    .select({
      archivedAt: apps.archivedAt,
      commitSha: sources.latestCommitSha,
      config: apps.config,
      configDigest: apps.configDigest,
      deploymentDigest: apps.deploymentDigest,
      id: apps.id,
      kind: apps.kind,
      manifestDigest: sources.latestManifestDigest,
      serverConfig: servers.config,
      serverId: servers.id,
      serverIp: servers.canonicalIp,
      serverPreparedAt: servers.preparedAt,
      serverPreparedConfigDigest: servers.preparedConfigDigest,
      serverConfigDigest: servers.configDigest,
      sourceId: sources.id,
      sourceInputDigest: apps.sourceInputDigest,
    })
    .from(apps)
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .innerJoin(servers, eq(servers.id, apps.serverId))
    .where(and(eq(apps.id, appId), eq(apps.workspaceId, workspaceId)))
    .limit(1);
  if (!app) throw notFound("App");
  return app;
}

function requireServerReady(target: {
  serverConfigDigest: string;
  serverPreparedAt: Date | null;
  serverPreparedConfigDigest: string | null;
}) {
  if (
    !target.serverPreparedAt ||
    target.serverPreparedConfigDigest !== target.serverConfigDigest
  ) {
    throw conflict(
      "Prepare this server before deploying apps or resources",
      "SERVER_SETUP_PENDING",
    );
  }
}

function requireDeployableType(
  config: (typeof apps.$inferSelect)["config"],
  expectedType: "app" | "resource",
) {
  const actualType = isNormalizedResource(config) ? "resource" : "app";
  if (actualType !== expectedType) {
    throw notFound(expectedType === "app" ? "App" : "Resource");
  }
}

async function findIdempotentDeployment(input: {
  appId: string;
  idempotencyKey: string;
  workspaceId: string;
}) {
  const [existing] = await getTowbarDatabase()
    .select(publicDeploymentSelection)
    .from(deployments)
    .where(
      and(
        eq(deployments.workspaceId, input.workspaceId),
        eq(deployments.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (existing && existing.appId !== input.appId) {
    throw conflict(
      "This Idempotency-Key was already used for a different app",
      "IDEMPOTENCY_KEY_CONFLICT",
    );
  }
  return existing;
}

async function getPublicDeployment(deploymentId: string, workspaceId: string) {
  const [deployment] = await getTowbarDatabase()
    .select(publicDeploymentSelection)
    .from(deployments)
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(deployments.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!deployment) throw notFound("Deployment");
  return deployment;
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
