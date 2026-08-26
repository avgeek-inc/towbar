import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import { z } from "zod";

import { isNormalizedResource } from "@workspace/towbar-core";
import {
  apps,
  deployableRuntimeStates,
  deployments,
  releases,
  serverChecks,
  serverPreparations,
  servers,
  sshHostKeys,
} from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueServerCheck } from "../../infrastructure/temporal.js";
import { publicDeploymentSelection } from "../deployment-selection.js";
import { resolveAwsSecret } from "../aws/service.js";
import { pruneServerCheckHistory } from "./check-retention.js";

export const sshLoginSecretSchema = z
  .object({
    privateKey: z
      .string()
      .min(64)
      .max(64 * 1_024),
  })
  .strict();

const serverSelection = {
  archivedAt: servers.archivedAt,
  canonicalIp: servers.canonicalIp,
  config: servers.config,
  configDigest: servers.configDigest,
  createdAt: servers.createdAt,
  id: servers.id,
  preparedAt: servers.preparedAt,
  preparedConfigDigest: servers.preparedConfigDigest,
  sourceId: servers.sourceId,
  sourceRevision: servers.sourceRevision,
  updatedAt: servers.updatedAt,
  workspaceId: servers.workspaceId,
} as const;

export async function listServers(workspaceId: string) {
  const database = getTowbarDatabase();
  const rows = await database
    .select(serverSelection)
    .from(servers)
    .where(
      and(eq(servers.workspaceId, workspaceId), isNull(servers.archivedAt)),
    )
    .orderBy(desc(servers.updatedAt));
  const latestPreparations = await getLatestServerPreparations(
    rows.map((server) => server.id),
  );
  return rows.map((server) =>
    toPublicServer(server, latestPreparations.get(server.id)),
  );
}

export async function listSourceServers(sourceId: string, workspaceId: string) {
  const database = getTowbarDatabase();
  const sourceServers = await database
    .select(serverSelection)
    .from(servers)
    .where(
      and(
        eq(servers.sourceId, sourceId),
        eq(servers.workspaceId, workspaceId),
        isNull(servers.archivedAt),
      ),
    )
    .orderBy(desc(servers.updatedAt));

  if (sourceServers.length === 0) return [];

  const serverIds = sourceServers.map((server) => server.id);
  const [checks, trustedKeys, latestPreparations] = await Promise.all([
    database
      .selectDistinctOn([serverChecks.serverId], {
        errorCode: serverChecks.errorCode,
        serverId: serverChecks.serverId,
      })
      .from(serverChecks)
      .where(inArray(serverChecks.serverId, serverIds))
      .orderBy(serverChecks.serverId, desc(serverChecks.createdAt)),
    database
      .selectDistinct({ serverId: sshHostKeys.serverId })
      .from(sshHostKeys)
      .where(
        and(
          inArray(sshHostKeys.serverId, serverIds),
          isNull(sshHostKeys.revokedAt),
        ),
      ),
    getLatestServerPreparations(serverIds),
  ]);
  const latestErrorByServer = new Map(
    checks.map((check) => [check.serverId, check.errorCode] as const),
  );
  const trustedServerIds = new Set(trustedKeys.map((key) => key.serverId));

  return sourceServers.map((server) => ({
    ...toPublicServer(server, latestPreparations.get(server.id)),
    hostKeyStatus:
      trustedServerIds.has(server.id) &&
      latestErrorByServer.get(server.id) !== "HOST_KEY_NOT_TRUSTED"
        ? ("trusted" as const)
        : ("untrusted" as const),
  }));
}

export async function getServer(serverId: string, workspaceId: string) {
  const database = getTowbarDatabase();
  const [server] = await database
    .select(serverSelection)
    .from(servers)
    .where(
      and(
        eq(servers.id, serverId),
        eq(servers.workspaceId, workspaceId),
        isNull(servers.archivedAt),
      ),
    )
    .limit(1);
  if (!server) throw notFound("Server");
  const latestPreparations = await getLatestServerPreparations([server.id]);
  return toPublicServer(server, latestPreparations.get(server.id));
}

export async function listServerApps(serverId: string, workspaceId: string) {
  return await listServerDeployables(serverId, workspaceId, "app");
}

export async function listServerResources(
  serverId: string,
  workspaceId: string,
) {
  return await listServerDeployables(serverId, workspaceId, "resource");
}

async function listServerDeployables(
  serverId: string,
  workspaceId: string,
  type: "app" | "resource",
) {
  await getServer(serverId, workspaceId);
  const rows = await getTowbarDatabase()
    .select({
      archivedAt: apps.archivedAt,
      config: apps.config,
      createdAt: apps.createdAt,
      description: apps.description,
      id: apps.id,
      kind: apps.kind,
      manifestId: apps.manifestId,
      name: apps.name,
      runtimeState: {
        checkedAt: deployableRuntimeStates.checkedAt,
        desiredState: deployableRuntimeStates.desiredState,
        driftReasons: deployableRuntimeStates.driftReasons,
        driftStatus: deployableRuntimeStates.driftStatus,
        healthStatus: deployableRuntimeStates.healthStatus,
        observedContainerName: deployableRuntimeStates.observedContainerName,
        observedImage: deployableRuntimeStates.observedImage,
        observedState: deployableRuntimeStates.observedState,
      },
      serverIp: servers.canonicalIp,
      serverPreparedAt: servers.preparedAt,
      serverPreparedConfigDigest: servers.preparedConfigDigest,
      serverConfigDigest: servers.configDigest,
      sourceId: apps.sourceId,
      sourceRevision: apps.sourceRevision,
      updatedAt: apps.updatedAt,
    })
    .from(apps)
    .innerJoin(servers, eq(servers.id, apps.serverId))
    .leftJoin(
      deployableRuntimeStates,
      eq(deployableRuntimeStates.appId, apps.id),
    )
    .where(
      and(
        eq(apps.serverId, serverId),
        isNull(apps.archivedAt),
        type === "app" ? eq(apps.kind, "app") : ne(apps.kind, "app"),
      ),
    )
    .orderBy(desc(apps.updatedAt));
  return rows.map((app) => {
    const {
      serverConfigDigest,
      serverPreparedAt,
      serverPreparedConfigDigest,
      ...publicApp
    } = app;
    return {
      ...publicApp,
      serverReady:
        Boolean(serverPreparedAt) &&
        serverPreparedConfigDigest === serverConfigDigest,
      runtimeState: app.runtimeState
        ? {
            ...app.runtimeState,
            desiredState: app.runtimeState.desiredState ?? "running",
            driftReasons: app.runtimeState.driftReasons ?? [],
            driftStatus: app.runtimeState.driftStatus ?? "unknown",
            healthStatus: app.runtimeState.healthStatus ?? "unknown",
            observedState: app.runtimeState.observedState ?? "unknown",
          }
        : {
            checkedAt: null,
            desiredState: "running" as const,
            driftReasons: [],
            driftStatus: "unknown" as const,
            healthStatus: "unknown" as const,
            observedContainerName: null,
            observedImage: null,
            observedState: "unknown" as const,
          },
    };
  });
}

export async function listServerDeployments(
  serverId: string,
  workspaceId: string,
) {
  await getServer(serverId, workspaceId);
  return await getTowbarDatabase()
    .select(publicDeploymentSelection)
    .from(deployments)
    .where(eq(deployments.serverId, serverId))
    .orderBy(desc(deployments.createdAt));
}

export async function requestServerCheck(input: {
  requestedBy: string | null;
  serverId: string;
  sourceId: string;
  workspaceId: string;
}) {
  const server = await getServer(input.serverId, input.workspaceId);
  if (server.sourceId !== input.sourceId) throw notFound("Source server");
  const [check] = await getTowbarDatabase()
    .insert(serverChecks)
    .values({
      requestedBy: input.requestedBy,
      serverId: input.serverId,
    })
    .returning();
  if (!check) throw new Error("Unable to create server check");
  try {
    await enqueueServerCheck({
      buildConcurrency: server.config.buildConcurrency ?? 1,
      checkId: check.id,
      serverIp: server.canonicalIp,
    });
    return toPublicServerCheck(check);
  } catch (error) {
    const database = getTowbarDatabase();
    await database
      .update(serverChecks)
      .set({
        errorCode: "TEMPORAL_UNAVAILABLE",
        errorMessage: "Server check queue is unavailable",
        finishedAt: new Date(),
        status: "failed",
      })
      .where(eq(serverChecks.id, check.id));
    await pruneServerCheckHistory(database, check.serverId);
    throw error;
  }
}

function toPublicServerCheck(check: typeof serverChecks.$inferSelect) {
  return {
    createdAt: check.createdAt,
    errorCode: check.errorCode,
    errorMessage: check.errorMessage,
    finishedAt: check.finishedAt,
    id: check.id,
    result: check.result,
    startedAt: check.startedAt,
    status: check.status,
  };
}

export async function getServerCheckExecutionContext(checkId: string) {
  const [context] = await getTowbarDatabase()
    .select({
      checkId: serverChecks.id,
      config: servers.config,
      serverId: servers.id,
      sourceId: servers.sourceId,
      workspaceId: servers.workspaceId,
    })
    .from(serverChecks)
    .innerJoin(servers, eq(servers.id, serverChecks.serverId))
    .where(eq(serverChecks.id, checkId))
    .limit(1);
  if (!context) throw notFound("Server check");
  const login = sshLoginSecretSchema.parse(
    await resolveAwsSecret({
      secretReference: context.config.secrets.login,
      sourceId: context.sourceId,
      workspaceId: context.workspaceId,
    }),
  );
  const trustedHostKeys = await getTowbarDatabase()
    .select({
      algorithm: sshHostKeys.algorithm,
      fingerprint: sshHostKeys.fingerprint,
      publicKey: sshHostKeys.publicKey,
    })
    .from(sshHostKeys)
    .where(
      and(
        eq(sshHostKeys.serverId, context.serverId),
        isNull(sshHostKeys.revokedAt),
      ),
    );
  const deployables = await getTowbarDatabase()
    .select({
      config: apps.config,
      deployableId: apps.id,
      desiredState: deployableRuntimeStates.desiredState,
    })
    .from(apps)
    .leftJoin(
      deployableRuntimeStates,
      eq(deployableRuntimeStates.appId, apps.id),
    )
    .where(and(eq(apps.serverId, context.serverId), isNull(apps.archivedAt)));
  const deployableIds = deployables.map(
    (deployable) => deployable.deployableId,
  );
  const retainedReleases = deployableIds.length
    ? await getTowbarDatabase()
        .select({
          appId: releases.appId,
          containerName: releases.containerName,
          imageTag: releases.imageTag,
          status: releases.status,
        })
        .from(releases)
        .where(
          and(
            inArray(releases.appId, deployableIds),
            inArray(releases.status, ["current", "previous"]),
          ),
        )
    : [];
  const currentReleaseByDeployable = new Map(
    retainedReleases
      .filter((release) => release.status === "current")
      .map((release) => [release.appId, release] as const),
  );
  await getTowbarDatabase()
    .update(serverChecks)
    .set({ startedAt: new Date(), status: "running" })
    .where(eq(serverChecks.id, checkId));
  return {
    ...context,
    expectedDeployables: deployables.map((deployable) => {
      const release = currentReleaseByDeployable.get(deployable.deployableId);
      const resource = isNormalizedResource(deployable.config)
        ? deployable.config
        : null;
      const containerPort = deployable.config.container.port;
      return {
        connectivity: containerPort
          ? {
              containerPort,
              hostPort: resource?.access?.sshTunnel.hostPort ?? null,
              network: deployable.config.container.network ?? null,
              networkAlias: resource?.container.networkAlias ?? null,
            }
          : null,
        deployableId: deployable.deployableId,
        desiredState: deployable.desiredState ?? "running",
        health: resource
          ? resource.health
          : { ...deployable.config.health, type: "http" as const },
        release: release
          ? {
              containerName: release.containerName,
              imageTag: release.imageTag,
            }
          : null,
      };
    }),
    expectedImageTags: retainedReleases.map((release) => release.imageTag),
    login,
    trustedHostKeys,
  };
}

export async function finishServerCheck(
  checkId: string,
  input:
    | { result: Record<string, unknown>; status: "succeeded" }
    | {
        errorCode: string;
        errorMessage: string;
        result?: Record<string, unknown>;
        status: "failed";
      },
) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const finishedAt = new Date();
    const [check] = await transaction
      .update(serverChecks)
      .set({
        errorCode: input.status === "failed" ? input.errorCode : null,
        errorMessage: input.status === "failed" ? input.errorMessage : null,
        finishedAt,
        result: input.result ?? null,
        status: input.status,
      })
      .where(eq(serverChecks.id, checkId))
      .returning();
    if (!check) throw notFound("Server check");
    if (input.status === "succeeded") {
      const runtime = parseRuntimeInspections(input.result.runtime);
      const allowed = new Set(
        (
          await transaction
            .select({ id: apps.id })
            .from(apps)
            .where(eq(apps.serverId, check.serverId))
        ).map((app) => app.id),
      );
      for (const inspection of runtime) {
        if (!allowed.has(inspection.deployableId)) continue;
        await transaction
          .insert(deployableRuntimeStates)
          .values({
            appId: inspection.deployableId,
            checkedAt: finishedAt,
            driftReasons: inspection.driftReasons,
            driftStatus: inspection.driftStatus,
            healthStatus: inspection.healthStatus,
            lastCheckId: check.id,
            observedContainerName: inspection.observedContainerName,
            observedImage: inspection.observedImage,
            observedState: inspection.observedState,
            updatedAt: finishedAt,
          })
          .onConflictDoUpdate({
            target: deployableRuntimeStates.appId,
            set: {
              checkedAt: finishedAt,
              driftReasons: inspection.driftReasons,
              driftStatus: inspection.driftStatus,
              healthStatus: inspection.healthStatus,
              lastCheckId: check.id,
              observedContainerName: inspection.observedContainerName,
              observedImage: inspection.observedImage,
              observedState: inspection.observedState,
              updatedAt: finishedAt,
            },
          });
      }
    }
    await pruneServerCheckHistory(transaction, check.serverId);
    return check;
  });
}

function parseRuntimeInspections(value: unknown) {
  return z
    .array(
      z
        .object({
          deployableId: z.string().uuid(),
          driftReasons: z.array(z.string().max(500)).max(20),
          driftStatus: z.enum(["drifted", "in_sync", "unknown"]),
          healthStatus: z.enum([
            "healthy",
            "none",
            "starting",
            "unhealthy",
            "unknown",
          ]),
          observedContainerName: z.string().max(255).nullable(),
          observedImage: z.string().max(512).nullable(),
          observedState: z.enum(["missing", "running", "stopped", "unknown"]),
        })
        .strict(),
    )
    .parse(value);
}

async function getLatestServerPreparations(serverIds: string[]) {
  if (serverIds.length === 0) {
    return new Map<
      string,
      {
        configDigest: string;
        status: "queued" | "running" | "succeeded" | "failed";
      }
    >();
  }
  const preparations = await getTowbarDatabase()
    .selectDistinctOn([serverPreparations.serverId], {
      configDigest: serverPreparations.configDigest,
      serverId: serverPreparations.serverId,
      status: serverPreparations.status,
    })
    .from(serverPreparations)
    .where(inArray(serverPreparations.serverId, serverIds))
    .orderBy(serverPreparations.serverId, desc(serverPreparations.createdAt));
  return new Map(
    preparations.map((preparation) => [
      preparation.serverId,
      {
        configDigest: preparation.configDigest,
        status: preparation.status,
      },
    ]),
  );
}

function toPublicServer(
  server: typeof servers.$inferSelect,
  latestPreparation?: {
    configDigest: string;
    status: "queued" | "running" | "succeeded" | "failed";
  },
) {
  const {
    configDigest,
    preparedConfigDigest,
    workspaceId: _workspaceId,
    ...publicServer
  } = server;
  const ready =
    Boolean(server.preparedAt) && preparedConfigDigest === configDigest;
  const currentPreparation = latestPreparation?.configDigest === configDigest;
  return {
    ...publicServer,
    setupStatus: ready
      ? ("ready" as const)
      : currentPreparation &&
          (latestPreparation.status === "queued" ||
            latestPreparation.status === "running")
        ? ("preparing" as const)
        : currentPreparation && latestPreparation.status === "failed"
          ? ("failed" as const)
          : ("pending" as const),
  };
}
