import { removeServer } from "../servers/lifecycle.js";
import { authorizeQueuedEffect, withActor } from "../auth/actor-context.js";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import {
  type LogDrainHealth,
  type LogDrainTarget,
  type NormalizedDeployable,
  type TelemetryPolicy,
  isNormalizedCompose,
  logDrainPublicConfiguration,
  managedTelemetryNetworkName,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  releases,
  serverLogDrains,
  servers,
  sourceEnvironments,
  sources,
  sshHostKeys,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { requireActor } from "../auth/actor-context.js";
import { conflict } from "../../http/errors.js";
import { reportLogDrainHealth } from "./health.js";
import { resolveServerCredentials } from "../secrets/store.js";
import { emitNotificationEvent } from "../notifications/service.js";
import { getRuntimeLogDrains } from "../../infrastructure/runtime-log-drains.js";
import { getRuntimeIntegration } from "../../infrastructure/runtime-integrations.js";
import { getEnv } from "../../env.js";

function telemetryPolicies(config: NormalizedDeployable): TelemetryPolicy[] {
  if (isNormalizedCompose(config))
    return Object.values(config.services).flatMap((service) =>
      service.telemetry ? [service.telemetry] : [],
    );
  return config.telemetry ? [config.telemetry] : [];
}

export async function listLogDrains(workspaceId: string) {
  requireActor(workspaceId, ["integration.manage"]);
  const agents = await getTowbarDatabase()
    .select({
      serverId: servers.id,
      name: servers.canonicalIp,
      status: serverLogDrains.status,
      checkedAt: serverLogDrains.checkedAt,
      errorMessage: serverLogDrains.errorMessage,
      health: serverLogDrains.health,
      diagnostics: serverLogDrains.details,
    })
    .from(serverLogDrains)
    .innerJoin(servers, eq(servers.id, serverLogDrains.serverId))
    .where(
      and(
        eq(serverLogDrains.workspaceId, workspaceId),
        eq(serverLogDrains.integrationKind, "log-forwarding"),
        isNull(servers.archivedAt),
      ),
    );
  return {
    configurations: getRuntimeLogDrains().map(
      ({ credential, provider, revision }) => ({
        ...logDrainPublicConfiguration(credential),
        revision,
        state: "enabled" as const,
        source: "environment" as const,
        health: agents.flatMap((agent) =>
          agent.health
            .filter(
              (health) =>
                health.provider === provider && health.revision === revision,
            )
            .map((health) => ({
              ...health,
              serverId: agent.serverId,
              serverName: agent.name,
            })),
        ),
      }),
    ),
  };
}

export async function dueLogDrainServers() {
  const db = getTowbarDatabase();
  const configured =
    getRuntimeLogDrains().length > 0 || Boolean(getRuntimeIntegration("otlp"));
  return await db
    .select({ serverId: servers.id })
    .from(servers)
    .leftJoin(
      serverLogDrains,
      and(
        eq(serverLogDrains.serverId, servers.id),
        eq(serverLogDrains.integrationKind, "log-forwarding"),
      ),
    )
    .where(
      and(
        isNull(servers.archivedAt),
        configured
          ? or(
              isNotNull(serverLogDrains.serverId),
              isNotNull(servers.preparedAt),
            )
          : isNotNull(serverLogDrains.serverId),
      ),
    )
    .orderBy(sql`${serverLogDrains.checkedAt} asc nulls first`, servers.id)
    .limit(20);
}

export async function getLogDrainExecutionContext(serverId: string) {
  const db = getTowbarDatabase();
  const selected = await db.transaction(async (tx) => {
    const [server] = await tx
      .select()
      .from(servers)
      .where(and(eq(servers.id, serverId), isNull(servers.archivedAt)))
      .for("update");
    if (!server) return null;
    const [previous] = await tx
      .select()
      .from(serverLogDrains)
      .where(
        and(
          eq(serverLogDrains.serverId, serverId),
          eq(serverLogDrains.integrationKind, "log-forwarding"),
        ),
      );
    // Serialize installation intent with server removal, including lost responses.
    await tx
      .insert(serverLogDrains)
      .values({
        serverId,
        workspaceId: server.workspaceId,
        checkedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [serverLogDrains.serverId, serverLogDrains.integrationKind],
        set: { checkedAt: new Date(), status: "pending" },
      });
    return { server, previous };
  });
  if (!selected) return null;
  const { server, previous } = selected;
  const deployed = await db
    .select({
      name: apps.name,
      appId: apps.id,
      deploymentId: deployments.id,
      config: deployments.appSnapshot,
      containerName: releases.containerName,
      environment: sourceEnvironments.name,
      previewId: releases.previewEnvironmentId,
      sourceId: apps.sourceId,
    })
    .from(releases)
    .innerJoin(deployments, eq(deployments.id, releases.deploymentId))
    .innerJoin(apps, eq(apps.id, releases.appId))
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .innerJoin(
      sourceEnvironments,
      eq(sourceEnvironments.id, apps.sourceEnvironmentId),
    )
    .where(
      and(
        eq(deployments.serverId, serverId),
        eq(deployments.workspaceId, server.workspaceId),
        eq(releases.status, "current"),
        isNull(apps.archivedAt),
        eq(sources.status, "active"),
      ),
    );
  if (previous?.removalRequested) {
    await authorizeQueuedEffect(previous.requestedByActor, server.workspaceId, [
      "server.remove",
    ]);
    deployed.length = 0;
  }
  const targets: LogDrainTarget[] = deployed.flatMap((row) => {
    if (isNormalizedCompose(row.config)) return [];
    const providers = row.config.logDrains ?? [];
    return providers.length
      ? [
          {
            appId: row.appId,
            containerName: row.containerName,
            deploymentId: row.deploymentId,
            repositoryId: row.sourceId,
            teamId: server.workspaceId,
            kind: "container" as const,
            name: row.name,
            providers,
            environment: row.previewId
              ? `preview-${row.previewId}`
              : row.environment,
          },
        ]
      : [];
  });
  const otlpReferences = new Set(
    deployed.flatMap((row) =>
      telemetryPolicies(row.config).map((policy) => policy.integration),
    ),
  );
  const runtimeOtlp = getRuntimeIntegration("otlp");
  const customOtlp =
    runtimeOtlp?.provider === "otlp" && otlpReferences.has("otlp")
      ? runtimeOtlp
      : null;
  const customOtlpSlug = customOtlp ? "otlp" : null;
  const otlpPolicies = deployed.flatMap((row) =>
    telemetryPolicies(row.config).filter(
      (policy) => customOtlpSlug === policy.integration,
    ),
  );
  if (
    !targets.length &&
    !customOtlp &&
    (!previous || previous.status === "disabled")
  ) {
    await completeLogDrainReconciliation(serverId, {
      succeeded: true,
      active: false,
    });
    return null;
  }
  const needed = new Set(targets.flatMap((target) => target.providers));
  const runtimeDrains = getRuntimeLogDrains();
  const credentials = runtimeDrains
    .filter((item) => needed.has(item.provider))
    .map((item) => item.credential)
    .sort((a, b) => a.provider.localeCompare(b.provider));
  if (
    credentials.length &&
    targets.length &&
    (!server.preparedAt || server.preparedConfigDigest !== server.configDigest)
  )
    throw conflict("Prepare this server before configuring log forwarding");
  const { values } = await resolveServerCredentials({
    serverId,
    workspaceId: server.workspaceId,
  });
  if (!values.privateKey)
    throw conflict("Configure SSH credentials before log forwarding");
  const trustedHostKeys = await db
    .select({
      algorithm: sshHostKeys.algorithm,
      fingerprint: sshHostKeys.fingerprint,
      publicKey: sshHostKeys.publicKey,
    })
    .from(sshHostKeys)
    .where(
      and(eq(sshHostKeys.serverId, serverId), isNull(sshHostKeys.revokedAt)),
    );
  if (!trustedHostKeys.length)
    throw conflict("Trust this server's SSH host key first");
  return {
    serverId,
    config: server.config,
    login: { privateKey: values.privateKey },
    trustedHostKeys,
    credentials,
    revisions: Object.fromEntries(
      runtimeDrains.map((item) => [item.provider, item.revision]),
    ),
    health: previous?.health ?? [],
    targets: targets.sort((a, b) =>
      a.containerName.localeCompare(b.containerName),
    ),
    missing: [...needed].filter(
      (provider) =>
        !credentials.some((credential) => credential.provider === provider),
    ),
    customOtlp: customOtlp?.provider === "otlp" ? customOtlp : null,
    customOtlpSlug,
    otlpNetworks: customOtlp
      ? [
          ...new Set(
            deployed.flatMap((row) => {
              if (
                !telemetryPolicies(row.config).some(
                  (policy) => policy.integration === customOtlpSlug,
                )
              )
                return [];
              if (isNormalizedCompose(row.config))
                return [managedTelemetryNetworkName(serverId)];
              return [
                row.config.container.network ??
                  managedTelemetryNetworkName(serverId),
              ];
            }),
          ),
        ]
      : [],
    otlpSignals: [...new Set(otlpPolicies.flatMap((policy) => policy.signals))],
    otlpSampling:
      otlpPolicies.length > 0
        ? Math.min(...otlpPolicies.map((policy) => policy.sampling))
        : 1,
    otlpRedactAttributes: [
      ...new Set(
        otlpPolicies.flatMap((policy) => policy.redactAttributes ?? []),
      ),
    ],
    otlpCardinalityLimit:
      otlpPolicies.length > 0
        ? Math.min(...otlpPolicies.map((policy) => policy.cardinalityLimit))
        : 10_000,
  };
}
export async function completeLogDrainReconciliation(
  serverId: string,
  result: {
    succeeded: boolean;
    digest?: string;
    active?: boolean;
    diagnostics?: (typeof serverLogDrains.$inferSelect)["details"];
    missing?: string[];
    health?: LogDrainHealth[];
  },
) {
  const db = getTowbarDatabase();
  const [server] = await db
    .select({
      canonicalIp: servers.canonicalIp,
      previousStatus: serverLogDrains.status,
      workspaceId: servers.workspaceId,
    })
    .from(servers)
    .leftJoin(
      serverLogDrains,
      and(
        eq(serverLogDrains.serverId, servers.id),
        eq(serverLogDrains.integrationKind, "log-forwarding"),
      ),
    )
    .where(eq(servers.id, serverId));
  if (!server) return;
  if (result.health) await reportLogDrainHealth(serverId, result.health);
  const values = {
    checkedAt: new Date(),
    ...(result.succeeded && !result.active ? { health: [] } : {}),
    status: !result.succeeded
      ? "failed"
      : result.missing?.length
        ? "pending"
        : result.active
          ? "applied"
          : "disabled",
    errorMessage: !result.succeeded
      ? "Could not apply log forwarding. Check SSH access, Docker and outbound HTTPS."
      : result.missing?.length
        ? `Configure ${result.missing.join(", ")} in Integrations.`
        : null,
    ...(result.succeeded
      ? {
          appliedDigest: result.digest,
          appliedAt: new Date(),
          details: result.diagnostics ?? {},
        }
      : {}),
  };
  await db
    .insert(serverLogDrains)
    .values({ serverId, workspaceId: server.workspaceId, ...values })
    .onConflictDoUpdate({
      target: [serverLogDrains.serverId, serverLogDrains.integrationKind],
      set: values,
    });
  const checkedAt = values.checkedAt.toISOString();
  if (!result.succeeded && server.previousStatus !== "failed") {
    await emitNotificationEvent({
      workspaceId: server.workspaceId,
      serverId,
      type: "log-drain.pipeline_failed",
      dedupeKey: `log-drain:pipeline-failed:${checkedAt}`,
      payload: {
        title: "Log forwarding pipeline failed",
        message: `Towbar could not apply the log forwarding pipeline on ${server.canonicalIp}. Check SSH access, Docker, the integration configuration and outbound connectivity.`,
        occurredAt: checkedAt,
        source: null,
        entity: {
          id: serverId,
          kind: "server",
          name: server.canonicalIp,
        },
        details: {
          configuration: new URL(
            "/manage/integrations",
            getEnv().TOWBAR_APP_BASE_URL,
          ).toString(),
        },
      },
    });
  } else if (result.succeeded && server.previousStatus === "failed") {
    await emitNotificationEvent({
      workspaceId: server.workspaceId,
      serverId,
      type: "log-drain.pipeline_recovered",
      dedupeKey: `log-drain:pipeline-recovered:${checkedAt}`,
      payload: {
        title: "Log forwarding pipeline recovered",
        message: `Towbar successfully reconciled the log forwarding pipeline on ${server.canonicalIp}.`,
        occurredAt: checkedAt,
        source: null,
        entity: {
          id: serverId,
          kind: "server",
          name: server.canonicalIp,
        },
        details: {
          configuration: new URL(
            "/manage/integrations",
            getEnv().TOWBAR_APP_BASE_URL,
          ).toString(),
        },
      },
    });
  }
  if (result.succeeded && !result.active) {
    const [state] = await db
      .select()
      .from(serverLogDrains)
      .where(
        and(
          eq(serverLogDrains.serverId, serverId),
          eq(serverLogDrains.integrationKind, "log-forwarding"),
        ),
      );
    if (state?.removalRequested) {
      const actor = await authorizeQueuedEffect(
        state.requestedByActor,
        server.workspaceId,
        ["server.remove"],
      );
      await withActor(actor, () =>
        removeServer({
          serverId,
          workspaceId: server.workspaceId,
          requestedBy: state.requestedByActor?.userId ?? null,
        }),
      );
    }
  }
}
