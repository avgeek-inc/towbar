import { and, eq, isNull, ne, sql } from "drizzle-orm";
import {
  ManifestValidationError,
  reconcileManifest,
  resolveRepositoryEnvironment,
} from "@workspace/towbar-core";
import {
  apps,
  servers,
  sourceEnvironments,
  sourceSyncs,
} from "@workspace/towbar-database/schema";
import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { fetchGitHubEnvironmentSnapshot } from "../github/environment-snapshot.js";
import { fetchGitHubRepositoryTree } from "../github/client.js";
import { materializeEnvironment } from "./environment-materialization.js";
import { sourceRepository } from "./environments.js";

import type { NormalizedApp, NormalizedResource } from "@workspace/towbar-core";

export async function executeEnvironmentSync(
  syncId: string,
  workspaceId: string,
  dependencies = {
    snapshot: fetchGitHubEnvironmentSnapshot,
    tree: fetchGitHubRepositoryTree,
  },
) {
  const database = getTowbarDatabase();
  const [sync] = await database
    .select()
    .from(sourceSyncs)
    .where(eq(sourceSyncs.id, syncId));
  if (!sync?.sourceEnvironmentId) throw notFound("Environment sync");
  const source = await sourceRepository(sync.sourceId, workspaceId);
  if (sync.status === "succeeded") return sync;
  const [environment] = await database
    .select()
    .from(sourceEnvironments)
    .where(eq(sourceEnvironments.id, sync.sourceEnvironmentId));
  if (!environment) throw notFound("Environment");
  try {
    if (
      environment.disconnectedAt ||
      environment.mappingRevision !== sync.mappingRevision
    ) {
      throw conflict(
        "Environment mapping changed after this sync was queued",
        "STALE_ENVIRONMENT_SYNC",
      );
    }
    const [started] = await database
      .update(sourceSyncs)
      .set({ status: "running", startedAt: new Date() })
      .where(
        and(eq(sourceSyncs.id, sync.id), ne(sourceSyncs.status, "succeeded")),
      )
      .returning({ id: sourceSyncs.id });
    if (!started) {
      const [completed] = await database
        .select()
        .from(sourceSyncs)
        .where(eq(sourceSyncs.id, sync.id));
      if (!completed) throw notFound("Environment sync");
      return completed;
    }
    const snapshot = await dependencies.snapshot({
      ...source,
      branch: environment.branch,
    });
    const resolved = resolveRepositoryEnvironment({
      ...snapshot,
      branch: environment.branch,
      environment: environment.name,
    });
    const tree = await dependencies.tree({
      ...source,
      commitSha: snapshot.commitSha,
    });
    if (!tree.complete)
      throw conflict(
        "Repository tree is incomplete",
        "INCOMPLETE_REPOSITORY_TREE",
      );
    return await database.transaction(async (transaction) => {
      // Domain claims and entity identities must be checked against concurrent environment syncs.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`source-sync:${workspaceId}`}, 0))`,
      );
      const [currentEnvironment] = await transaction
        .select()
        .from(sourceEnvironments)
        .where(eq(sourceEnvironments.id, environment.id))
        .for("update");
      if (
        !currentEnvironment ||
        currentEnvironment.disconnectedAt ||
        currentEnvironment.mappingRevision !== sync.mappingRevision
      ) {
        throw conflict(
          "Environment mapping changed during sync",
          "STALE_ENVIRONMENT_SYNC",
        );
      }
      if (currentEnvironment.latestSuccessfulSyncId) {
        const [latest] = await transaction
          .select()
          .from(sourceSyncs)
          .where(eq(sourceSyncs.id, currentEnvironment.latestSuccessfulSyncId));
        if (
          latest &&
          (latest.createdAt > sync.createdAt || latest.id === sync.id)
        ) {
          if (latest.id === sync.id) return latest;
          throw conflict(
            "A newer environment sync already completed",
            "STALE_ENVIRONMENT_SYNC",
          );
        }
      }
      const current = await transaction
        .select()
        .from(apps)
        .where(eq(apps.sourceEnvironmentId, environment.id));
      for (const kind of ["app", "resource"] as const) {
        const hasExisting = current.some((entity) =>
          kind === "app" ? entity.kind === "app" : entity.kind !== "app",
        );
        const directory = kind === "app" ? ".towbar/apps" : ".towbar/resources";
        if (hasExisting && !snapshot.directories.includes(directory)) {
          throw conflict(
            `${directory} is missing; existing configuration was preserved`,
            "ENTITY_DIRECTORY_MISSING",
          );
        }
      }
      const workspaceServers = await transaction
        .select()
        .from(servers)
        .where(
          and(eq(servers.workspaceId, workspaceId), isNull(servers.archivedAt)),
        );
      const serverBySlug = new Map(
        workspaceServers
          .filter((server) => server.slug)
          .map((server) => [server.slug!, server]),
      );
      const desired = [
        ...resolved.manifest.apps,
        ...(resolved.manifest.resources ?? []),
      ];
      const claimedDomains = new Set(
        desired.flatMap((entity) =>
          entity.domains
            ? [
                entity.domains.primary,
                ...entity.domains.redirects.map((redirect) => redirect.host),
              ]
            : [],
        ),
      );
      const otherInstances = await transaction
        .select({ config: apps.config })
        .from(apps)
        .where(
          and(
            eq(apps.workspaceId, workspaceId),
            ne(apps.sourceEnvironmentId, environment.id),
            isNull(apps.archivedAt),
          ),
        );
      for (const other of otherInstances) {
        for (const domain of other.config.domains
          ? [
              other.config.domains.primary,
              ...other.config.domains.redirects.map(
                (redirect) => redirect.host,
              ),
            ]
          : []) {
          if (claimedDomains.has(domain))
            throw conflict(
              `Domain '${domain}' is already assigned to another environment`,
              "DOMAIN_CONFLICT",
            );
        }
      }
      const materialized = current.map((row) => ({
        ...row,
        identity: row.manifestId,
      }));
      const reconciliation = reconcileManifest({
        currentApps: materialized
          .filter((row) => row.kind === "app")
          .map((row) => ({ ...row, config: row.config as NormalizedApp })),
        currentResources: materialized
          .filter((row) => row.kind !== "app")
          .map((row) => ({ ...row, config: row.config as NormalizedResource })),
        desired: resolved.manifest,
      });
      await materializeEnvironment(transaction, {
        reconciliation,
        sourceId: source.id,
        environment,
        workspaceId,
        commitSha: snapshot.commitSha,
        tree,
        serverBySlug,
        requiredSecrets: resolved.manifest.requiredSecrets,
      });
      const [completed] = await transaction
        .update(sourceSyncs)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          commitSha: snapshot.commitSha,
          manifestDigest: resolved.digest,
          normalizedManifest: resolved.manifest,
          rawManifest: JSON.stringify({
            root: snapshot.root,
            files: snapshot.files,
          }),
          reconciliation,
          issues: [],
        })
        .where(eq(sourceSyncs.id, sync.id))
        .returning();
      await transaction
        .update(sourceEnvironments)
        .set({
          latestSuccessfulSyncId: sync.id,
          latestCommitSha: snapshot.commitSha,
          latestManifestDigest: resolved.digest,
          previewsEnabled: resolved.manifest.previewsEnabled,
          updatedAt: new Date(),
        })
        .where(eq(sourceEnvironments.id, environment.id));
      return completed;
    });
  } catch (error) {
    await database
      .update(sourceSyncs)
      .set({
        status: "failed",
        finishedAt: new Date(),
        issues:
          error instanceof ManifestValidationError
            ? error.issues
            : [
                {
                  message:
                    error instanceof Error
                      ? error.message
                      : "Environment sync failed",
                  path: [],
                },
              ],
      })
      .where(
        and(eq(sourceSyncs.id, sync.id), ne(sourceSyncs.status, "succeeded")),
      );
    throw error;
  }
}
