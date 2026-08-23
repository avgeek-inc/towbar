import { and, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";

import {
  ManifestValidationError,
  parseDeploymentManifest,
  reconcileManifest,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  githubInstallations,
  githubWebhookDeliveries,
  releases,
  resourceOperations,
  serverChecks,
  servers,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";

import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  enqueueSourceSync,
  wakeMaintenanceWorkflow,
} from "../../infrastructure/temporal.js";
import { fetchGitHubSourceSnapshot } from "../github/client.js";
import { getGitHubInstallationForSource } from "../github/service.js";
import {
  publicSourceSelection,
  publicSourceSyncSelection,
} from "./public-selections.js";
import {
  assertStableDeployableKinds,
  loadCurrentInventory,
} from "./inventory.js";
import {
  calculateDesiredDeploymentDigests,
  calculateLegacyReleaseDigests,
  fetchRepositoryTreeForDeploymentInputs,
} from "./deployment-digests.js";
import { applyDeployableAction, upsertServer } from "./materialization.js";

import type { ManifestIssue } from "@workspace/towbar-core";

export async function listSources(workspaceId: string) {
  return await getTowbarDatabase()
    .select(publicSourceSelection)
    .from(sources)
    .where(eq(sources.workspaceId, workspaceId))
    .orderBy(desc(sources.updatedAt));
}

export async function createSource(input: {
  branch: string;
  githubInstallationId: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
}) {
  await getGitHubInstallationForSource({
    installationId: input.githubInstallationId,
    workspaceId: input.workspaceId,
  });
  const [source] = await getTowbarDatabase()
    .insert(sources)
    .values(input)
    .returning(publicSourceSelection);
  if (!source) throw new Error("Unable to create Source");
  return source;
}

export async function getSource(sourceId: string, workspaceId: string) {
  const [source] = await getTowbarDatabase()
    .select(publicSourceSelection)
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  return source;
}

export async function deleteSource(sourceId: string, workspaceId: string) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const [source] = await transaction
      .select({ id: sources.id })
      .from(sources)
      .where(
        and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)),
      )
      .for("update")
      .limit(1);
    if (!source) throw notFound("Source");
    await transaction
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.sourceId, sourceId))
      .for("update");

    const [activeDeployment, activeCheck, activeSync, activeOperation] =
      await Promise.all([
        transaction
          .select({ id: deployments.id })
          .from(deployments)
          .where(
            and(
              eq(deployments.sourceId, sourceId),
              notInArray(deployments.state, [
                "cancelled",
                "failed",
                "skipped",
                "succeeded",
                "succeeded_with_warnings",
              ]),
            ),
          )
          .limit(1),
        transaction
          .select({ id: serverChecks.id })
          .from(serverChecks)
          .innerJoin(servers, eq(servers.id, serverChecks.serverId))
          .where(
            and(
              eq(servers.sourceId, sourceId),
              inArray(serverChecks.status, ["queued", "running"]),
            ),
          )
          .limit(1),
        transaction
          .select({ id: sourceSyncs.id })
          .from(sourceSyncs)
          .where(
            and(
              eq(sourceSyncs.sourceId, sourceId),
              inArray(sourceSyncs.status, ["queued", "running"]),
            ),
          )
          .limit(1),
        transaction
          .select({ id: resourceOperations.id })
          .from(resourceOperations)
          .where(
            and(
              eq(resourceOperations.sourceId, sourceId),
              inArray(resourceOperations.state, ["queued", "running"]),
            ),
          )
          .limit(1),
      ]);
    if (
      activeDeployment.length ||
      activeCheck.length ||
      activeSync.length ||
      activeOperation.length
    ) {
      throw conflict(
        "Cancel or wait for active Source operations before deletion",
        "SOURCE_BUSY",
      );
    }

    const appRows = await transaction
      .select({ id: apps.id })
      .from(apps)
      .where(eq(apps.sourceId, sourceId));
    const appIds = appRows.map((app) => app.id);
    if (appIds.length > 0) {
      await transaction.delete(releases).where(inArray(releases.appId, appIds));
    }
    await transaction
      .delete(deployments)
      .where(eq(deployments.sourceId, sourceId));
    await transaction.delete(apps).where(eq(apps.sourceId, sourceId));
    await transaction.delete(servers).where(eq(servers.sourceId, sourceId));
    await transaction
      .delete(githubWebhookDeliveries)
      .where(eq(githubWebhookDeliveries.sourceId, sourceId));
    await transaction.delete(sources).where(eq(sources.id, sourceId));

    return { id: source.id };
  });
}

export async function previewSourceSync(sourceId: string, workspaceId: string) {
  const source = await getSourceWithInstallation(sourceId, workspaceId);
  const { parsed, repositoryTree, snapshot } =
    await fetchConfiguredSourceSnapshot(source);
  calculateDesiredDeploymentDigests({
    commitSha: snapshot.commitSha,
    manifest: parsed.manifest,
    repositoryTree,
  });
  const current = await loadCurrentInventory(sourceId);
  assertStableDeployableKinds(current, parsed.manifest);
  return {
    commitSha: snapshot.commitSha,
    manifest: parsed.manifest,
    manifestDigest: parsed.digest,
    reconciliation: reconcileManifest({
      currentApps: current.apps,
      currentResources: current.resources,
      currentServers: current.servers,
      desired: parsed.manifest,
    }),
  };
}

export async function requestSourceSync(input: {
  requestedBy: string | null;
  sourceId: string;
  workspaceId: string;
}) {
  await getSource(input.sourceId, input.workspaceId);
  const [sync] = await getTowbarDatabase()
    .insert(sourceSyncs)
    .values({ requestedBy: input.requestedBy, sourceId: input.sourceId })
    .returning({ id: sourceSyncs.id });
  if (!sync) throw new Error("Unable to create Source sync");
  try {
    await enqueueSourceSync({
      sourceId: input.sourceId,
      syncId: sync.id,
    });
    return sync;
  } catch (error) {
    await markSyncFailed(sync.id, error);
    throw error;
  }
}

export async function executeSourceSync(syncId: string) {
  const [sync] = await getTowbarDatabase()
    .select({
      sourceId: sourceSyncs.sourceId,
      workspaceId: sources.workspaceId,
    })
    .from(sourceSyncs)
    .innerJoin(sources, eq(sources.id, sourceSyncs.sourceId))
    .where(eq(sourceSyncs.id, syncId))
    .limit(1);
  if (!sync) throw notFound("Source sync");
  return await applySourceSync({ ...sync, syncId });
}

export async function synchronizeSourceNow(
  sourceId: string,
  workspaceId: string,
  requestedBy: string,
) {
  const [sync] = await getTowbarDatabase()
    .insert(sourceSyncs)
    .values({ requestedBy, sourceId })
    .returning({ id: sourceSyncs.id });
  if (!sync) throw new Error("Unable to create Source sync");
  return await applySourceSync({ sourceId, syncId: sync.id, workspaceId });
}

export async function listSourceSyncs(sourceId: string, workspaceId: string) {
  await getSource(sourceId, workspaceId);
  return await getTowbarDatabase()
    .select(publicSourceSyncSelection)
    .from(sourceSyncs)
    .where(eq(sourceSyncs.sourceId, sourceId))
    .orderBy(desc(sourceSyncs.createdAt));
}

export async function getSourceSync(
  sourceId: string,
  syncId: string,
  workspaceId: string,
) {
  await getSource(sourceId, workspaceId);
  const [sync] = await getTowbarDatabase()
    .select(publicSourceSyncSelection)
    .from(sourceSyncs)
    .where(and(eq(sourceSyncs.id, syncId), eq(sourceSyncs.sourceId, sourceId)))
    .limit(1);
  if (!sync) throw notFound("Source sync");
  return sync;
}

export async function getSourceManifest(sourceId: string, workspaceId: string) {
  const [source] = await getTowbarDatabase()
    .select({ latestSuccessfulSyncId: sources.latestSuccessfulSyncId })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  if (!source.latestSuccessfulSyncId) return null;
  const [sync] = await getTowbarDatabase()
    .select({
      commitSha: sourceSyncs.commitSha,
      manifest: sourceSyncs.normalizedManifest,
      manifestDigest: sourceSyncs.manifestDigest,
      rawManifest: sourceSyncs.rawManifest,
    })
    .from(sourceSyncs)
    .where(eq(sourceSyncs.id, source.latestSuccessfulSyncId))
    .limit(1);
  return sync ?? null;
}

async function applySourceSync(input: {
  sourceId: string;
  syncId: string;
  workspaceId: string;
}) {
  await getTowbarDatabase()
    .update(sourceSyncs)
    .set({ startedAt: new Date(), status: "running" })
    .where(eq(sourceSyncs.id, input.syncId));
  try {
    const source = await getSourceWithInstallation(
      input.sourceId,
      input.workspaceId,
    );
    const { parsed, repositoryTree, snapshot } =
      await fetchConfiguredSourceSnapshot(source);
    const current = await loadCurrentInventory(input.sourceId);
    assertStableDeployableKinds(current, parsed.manifest);
    const reconciliation = reconcileManifest({
      currentApps: current.apps,
      currentResources: current.resources,
      currentServers: current.servers,
      desired: parsed.manifest,
    });
    const desiredDeploymentDigests = calculateDesiredDeploymentDigests({
      commitSha: snapshot.commitSha,
      manifest: parsed.manifest,
      repositoryTree,
    });
    const legacyReleaseDigests = await calculateLegacyReleaseDigests({
      commitSha: snapshot.commitSha,
      manifest: parsed.manifest,
      repositoryTree,
      repository: source,
      sourceId: input.sourceId,
    });
    await getTowbarDatabase().transaction(async (transaction) => {
      const desiredDomains = new Map(
        [...parsed.manifest.apps, ...(parsed.manifest.resources ?? [])].flatMap(
          (app) =>
            app.domains
              ? [
                  [app.domains.primary, app.id] as const,
                  ...app.domains.redirects.map(
                    (redirect) => [redirect.host, app.id] as const,
                  ),
                ]
              : [],
        ),
      );
      if (desiredDomains.size > 0) {
        const otherApps = await transaction
          .select({ config: apps.config, manifestId: apps.manifestId })
          .from(apps)
          .where(
            and(
              eq(apps.workspaceId, input.workspaceId),
              ne(apps.sourceId, input.sourceId),
              isNull(apps.archivedAt),
            ),
          );
        for (const otherApp of otherApps) {
          const domains = otherApp.config.domains
            ? [
                otherApp.config.domains.primary,
                ...otherApp.config.domains.redirects.map(
                  (redirect) => redirect.host,
                ),
              ]
            : [];
          for (const domain of domains) {
            const owner = desiredDomains.get(domain);
            if (owner) {
              throw conflict(
                `Domain '${domain}' for app '${owner}' is already claimed by app '${otherApp.manifestId}'`,
                "DOMAIN_CONFLICT",
              );
            }
          }
        }
      }

      const serverIds = new Map<string, string>();
      for (const [releaseId, digest] of legacyReleaseDigests) {
        await transaction
          .update(releases)
          .set(digest)
          .where(eq(releases.id, releaseId));
      }
      for (const action of reconciliation.servers) {
        if (action.action === "archive") {
          if (!action.current) continue;
          await transaction
            .update(servers)
            .set({ archivedAt: new Date(), updatedAt: new Date() })
            .where(
              and(
                eq(servers.id, action.current.id),
                eq(servers.sourceId, input.sourceId),
              ),
            );
          continue;
        }
        if (!action.desired) continue;
        const serverId = await upsertServer(transaction, {
          action,
          commitSha: snapshot.commitSha,
          sourceId: input.sourceId,
          workspaceId: input.workspaceId,
        });
        serverIds.set(action.desired.ip, serverId);
      }

      for (const action of reconciliation.apps) {
        await applyDeployableAction(transaction, {
          action,
          commitSha: snapshot.commitSha,
          deploymentDigests: desiredDeploymentDigests,
          serverIds,
          sourceId: input.sourceId,
          workspaceId: input.workspaceId,
        });
      }
      for (const action of reconciliation.resources) {
        await applyDeployableAction(transaction, {
          action,
          commitSha: snapshot.commitSha,
          deploymentDigests: desiredDeploymentDigests,
          serverIds,
          sourceId: input.sourceId,
          workspaceId: input.workspaceId,
        });
      }

      const now = new Date();
      await transaction
        .update(sourceSyncs)
        .set({
          commitSha: snapshot.commitSha,
          finishedAt: now,
          issues: [],
          manifestDigest: parsed.digest,
          normalizedManifest: parsed.manifest,
          rawManifest: snapshot.manifestSource,
          reconciliation,
          status: "succeeded",
        })
        .where(eq(sourceSyncs.id, input.syncId));
      await transaction
        .update(sources)
        .set({
          branch: parsed.manifest.source.branch,
          latestCommitSha: snapshot.commitSha,
          latestManifestDigest: parsed.digest,
          latestSuccessfulSyncId: input.syncId,
          updatedAt: now,
        })
        .where(eq(sources.id, input.sourceId));
    });
    void wakeMaintenanceWorkflow().catch(() => undefined);
    return {
      commitSha: snapshot.commitSha,
      manifest: parsed.manifest,
      manifestDigest: parsed.digest,
      reconciliation,
      syncId: input.syncId,
    };
  } catch (error) {
    await markSyncFailed(input.syncId, error);
    throw error;
  }
}

async function getSourceWithInstallation(
  sourceId: string,
  workspaceId: string,
) {
  const [source] = await getTowbarDatabase()
    .select({
      branch: sources.branch,
      installationId: githubInstallations.installationId,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      status: sources.status,
    })
    .from(sources)
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)))
    .limit(1);
  if (!source) throw notFound("Source");
  if (source.status === "archived") {
    throw conflict("Archived Sources cannot be synchronized");
  }
  return source;
}

async function fetchConfiguredSourceSnapshot(
  source: Awaited<ReturnType<typeof getSourceWithInstallation>>,
) {
  let snapshot = await fetchGitHubSourceSnapshot(source);
  let parsed = parseDeploymentManifest(snapshot.manifestSource);
  const configuredBranch = parsed.manifest.source.branch;
  if (configuredBranch === source.branch) {
    return {
      parsed,
      repositoryTree: await fetchRepositoryTreeForDeploymentInputs({
        commitSha: snapshot.commitSha,
        manifestApps: parsed.manifest.apps,
        repository: source,
      }),
      snapshot,
    };
  }

  snapshot = await fetchGitHubSourceSnapshot({
    ...source,
    branch: configuredBranch,
  });
  parsed = parseDeploymentManifest(snapshot.manifestSource);
  if (parsed.manifest.source.branch !== configuredBranch) {
    throw conflict(
      `Branch '${configuredBranch}' must declare itself as source.branch`,
      "SOURCE_BRANCH_REDIRECT",
    );
  }
  return {
    parsed,
    repositoryTree: await fetchRepositoryTreeForDeploymentInputs({
      commitSha: snapshot.commitSha,
      manifestApps: parsed.manifest.apps,
      repository: source,
    }),
    snapshot,
  };
}

async function markSyncFailed(syncId: string, error: unknown) {
  const issues: ManifestIssue[] =
    error instanceof ManifestValidationError
      ? error.issues
      : [
          {
            message:
              error instanceof Error ? error.message : "Source sync failed",
            path: [],
          },
        ];
  await getTowbarDatabase()
    .update(sourceSyncs)
    .set({ finishedAt: new Date(), issues, status: "failed" })
    .where(eq(sourceSyncs.id, syncId));
}
