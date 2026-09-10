import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  resolveRepositoryEnvironment,
  sourceEnvironmentMappingSchema,
} from "@workspace/towbar-core";
import {
  auditEvents,
  sourceEnvironments,
  sources,
} from "@workspace/towbar-database/schema";
import { conflict } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getGitHubInstallationForSource } from "../github/service.js";
import { fetchGitHubEnvironmentSnapshot } from "../github/environment-snapshot.js";
import { publicSourceSelection } from "./public-selections.js";
import { requestEnvironmentSync } from "./environments.js";

export const sourceDiscoverySchema = z
  .object({
    githubInstallationId: z.string().uuid(),
    repositoryOwner: z.string().trim().min(1).max(255),
    repositoryName: z.string().trim().min(1).max(255),
    discoveryBranch: sourceEnvironmentMappingSchema.shape.branch,
  })
  .strict();
export const sourceConnectionSchema = sourceDiscoverySchema.extend({
  environments: z
    .array(sourceEnvironmentMappingSchema)
    .min(1)
    .max(20)
    .refine(
      (mappings) =>
        new Set(mappings.map((mapping) => mapping.environment)).size ===
        mappings.length,
      "An environment can only be connected once",
    ),
});

export async function discoverSource(
  input: z.infer<typeof sourceDiscoverySchema> & { workspaceId: string },
) {
  const installation = await getGitHubInstallationForSource({
    installationId: input.githubInstallationId,
    workspaceId: input.workspaceId,
  });
  const snapshot = await fetchGitHubEnvironmentSnapshot({
    installationId: installation.installationId,
    repositoryName: input.repositoryName,
    repositoryOwner: input.repositoryOwner,
    branch: input.discoveryBranch,
  });
  return {
    commitSha: snapshot.commitSha,
    environments: Object.entries(snapshot.configuration.environments).map(
      ([name, config]) => ({
        name,
        previewsEnabled: config.previews?.enabled ?? false,
      }),
    ),
  };
}

export async function connectRepositorySource(
  input: z.infer<typeof sourceConnectionSchema> & {
    workspaceId: string;
    actorUserId: string;
  },
) {
  const installation = await getGitHubInstallationForSource({
    installationId: input.githubInstallationId,
    workspaceId: input.workspaceId,
  });
  const discovered = await discoverSource(input);
  const resolved: {
    environment: string;
    branch: string;
    previewsEnabled: boolean;
  }[] = [];
  for (const mapping of input.environments) {
    if (
      !discovered.environments.some(
        (environment) => environment.name === mapping.environment,
      )
    ) {
      throw conflict(
        `Environment '${mapping.environment}' is not declared on the discovery branch`,
        "ENVIRONMENT_NOT_DECLARED",
      );
    }
    const snapshot = await fetchGitHubEnvironmentSnapshot({
      installationId: installation.installationId,
      repositoryName: input.repositoryName,
      repositoryOwner: input.repositoryOwner,
      branch: mapping.branch,
    });
    const environment = resolveRepositoryEnvironment({
      ...snapshot,
      ...mapping,
    });
    resolved.push({
      ...mapping,
      previewsEnabled: environment.manifest.previewsEnabled,
    });
  }
  const result = await getTowbarDatabase().transaction(async (transaction) => {
    const repositoryKey = `${input.workspaceId}:${input.repositoryOwner.toLowerCase()}/${input.repositoryName.toLowerCase()}`;
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${repositoryKey}, 0))`,
    );
    const [existing] = await transaction
      .select({ id: sources.id })
      .from(sources)
      .where(
        and(
          eq(sources.workspaceId, input.workspaceId),
          sql`lower(${sources.repositoryOwner}) = ${input.repositoryOwner.toLowerCase()}`,
          sql`lower(${sources.repositoryName}) = ${input.repositoryName.toLowerCase()}`,
        ),
      );
    if (existing)
      throw conflict(
        "This repository is already connected. Add an environment to the existing Source.",
        "SOURCE_ALREADY_CONNECTED",
      );
    const [source] = await transaction
      .insert(sources)
      .values({
        workspaceId: input.workspaceId,
        githubInstallationId: input.githubInstallationId,
        repositoryName: input.repositoryName,
        repositoryOwner: input.repositoryOwner,
      })
      .returning(publicSourceSelection);
    if (!source) throw new Error("Unable to connect Source");
    const environments = await transaction
      .insert(sourceEnvironments)
      .values(
        resolved.map((mapping) => ({
          sourceId: source.id,
          name: mapping.environment,
          branch: mapping.branch,
          previewsEnabled: mapping.previewsEnabled,
        })),
      )
      .returning();
    await transaction.insert(auditEvents).values({
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      action: "source.connected",
      targetType: "source",
      targetId: source.id,
      metadata: {
        environments: JSON.stringify(
          resolved.map(({ environment, branch }) => ({ environment, branch })),
        ),
      },
    });
    return { source, environments };
  });
  const syncs = [];
  for (const environment of result.environments) {
    try {
      const sync = await requestEnvironmentSync({
        sourceId: result.source.id,
        environmentId: environment.id,
        workspaceId: input.workspaceId,
        requestedBy: input.actorUserId,
        deployAfterSync: false,
      });
      syncs.push({
        environmentId: environment.id,
        syncId: sync.id,
        error: null,
      });
    } catch (error) {
      syncs.push({
        environmentId: environment.id,
        syncId: null,
        error:
          error instanceof Error ? error.message : "Sync could not be queued",
      });
    }
  }
  return { ...result, syncs };
}
