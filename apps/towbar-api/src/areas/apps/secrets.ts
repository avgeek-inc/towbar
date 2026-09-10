import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  isNormalizedResource,
  resolveSecretReferences,
  secretReferenceDependencies,
  secretStages,
  validateSecretReferences,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  previewEnvironments,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { notFound, unprocessable } from "../../http/errors.js";
import {
  mutateSecret,
  readSecretMetadata,
  readSecretValues,
  requireSecretOwner,
} from "../secrets/store.js";
import type { SecretDatabase, SecretOwner } from "../secrets/store.js";
import type { SecretMutation, SecretStage } from "@workspace/towbar-core";

export async function getEnvironmentSecretOwner(owner: SecretOwner) {
  const ownership = await requireSecretOwner(owner);
  if (owner.type !== "app") return { ...ownership, resource: false };
  const [app] = await getTowbarDatabase()
    .select({ config: apps.config })
    .from(apps)
    .where(and(eq(apps.id, owner.id), eq(apps.workspaceId, owner.workspaceId)))
    .limit(1);
  if (!app) throw notFound("App");
  return { ...ownership, resource: isNormalizedResource(app.config) };
}

export async function listEnvironmentSecrets(
  owner: SecretOwner,
  environment: string,
) {
  const ownership = await getEnvironmentSecretOwner(owner);
  if (
    (environment === "preview" || environment.startsWith("preview:")) &&
    ownership.resource
  )
    throw unprocessable("Resources do not support preview secrets");
  const stages = ownership.resource ? ["deployment" as const] : secretStages;
  const affected =
    owner.type === "source"
      ? await getTowbarDatabase()
          .select({
            id: apps.id,
            name: apps.name,
            kind: apps.kind,
            config: apps.config,
          })
          .from(apps)
          .where(
            and(
              eq(apps.sourceId, owner.id),
              eq(apps.workspaceId, owner.workspaceId),
              isNull(apps.archivedAt),
            ),
          )
      : [];
  const previewTargets =
    owner.type === "app" &&
    (environment === "preview" || environment.startsWith("preview:"))
      ? await getTowbarDatabase()
          .select({
            id: previewEnvironments.id,
            pullRequestNumber: previewEnvironments.pullRequestNumber,
          })
          .from(previewEnvironments)
          .where(
            and(
              eq(previewEnvironments.appId, owner.id),
              eq(previewEnvironments.workspaceId, owner.workspaceId),
              inArray(previewEnvironments.status, [
                "healthy",
                "failed",
                "building",
              ]),
            ),
          )
      : [];
  const successfulDeployments =
    owner.type === "app"
      ? await getTowbarDatabase()
          .selectDistinctOn([deployments.previewEnvironmentId], {
            previewId: deployments.previewEnvironmentId,
            revisions: deployments.secretRevisions,
          })
          .from(deployments)
          .where(
            and(
              eq(deployments.appId, owner.id),
              eq(
                deployments.environment,
                environment.startsWith("preview") ? "preview" : "production",
              ),
              inArray(deployments.state, [
                "succeeded",
                "succeeded_with_warnings",
              ]),
            ),
          )
          .orderBy(
            deployments.previewEnvironmentId,
            desc(deployments.createdAt),
          )
      : [];
  return await Promise.all(
    stages.map(async (stage) => {
      const local = await readSecretMetadata({ ...owner, environment, stage });
      const global =
        owner.type !== "workspace"
          ? await readSecretMetadata({
              workspaceId: owner.workspaceId,
              type: "workspace",
              environment,
              stage,
            })
          : { keys: [], revision: null, updatedAt: null };
      const shared =
        owner.type === "app"
          ? await readSecretMetadata({
              workspaceId: owner.workspaceId,
              type: "source",
              id: ownership.sourceId!,
              environment,
              stage,
            })
          : { keys: [], revision: null, updatedAt: null };
      const localValues =
        owner.type === "app"
          ? await readSecretValues({ ...owner, environment, stage })
          : { values: {} };
      const sourceValues =
        owner.type === "app" &&
        secretReferenceDependencies(localValues.values, {}).shared
          ? await readSecretValues({
              type: "source",
              id: ownership.sourceId!,
              workspaceId: owner.workspaceId,
              environment,
              stage,
            })
          : { values: {} };
      const dependencies = secretReferenceDependencies(
        localValues.values,
        sourceValues.values,
      );
      const revisions = successfulDeployments[0]?.revisions;
      const hasPendingRevisions = (
        deploymentRevisions?: Record<string, string | null> | null,
      ) =>
        local.revision !== (deploymentRevisions?.[`${stage}:local`] ?? null) ||
        (dependencies.shared &&
          shared.revision !==
            (deploymentRevisions?.[`${stage}:shared`] ?? null)) ||
        (dependencies.global &&
          global.revision !==
            (deploymentRevisions?.[`${stage}:global`] ?? null));
      return {
        stage,
        environment,
        ...local,
        inheritedKeys: [] as string[],
        inheritedOrigins: {} as Record<string, "global" | "source">,
        availableReferences: { globals: global.keys, source: shared.keys },
        inheritedRevisions: {
          global: global.revision,
          source: shared.revision,
        },
        pendingChanges:
          owner.type === "app" &&
          ((environment === "preview" || environment.startsWith("preview:")) &&
          previewTargets.length
            ? previewTargets.some((preview) =>
                hasPendingRevisions(
                  successfulDeployments.find(
                    (deployment) => deployment.previewId === preview.id,
                  )?.revisions,
                ),
              )
            : hasPendingRevisions(revisions)),
        affectedDeployables: previewTargets.length
          ? previewTargets.map((preview) => ({
              id: preview.id,
              name: `PR #${preview.pullRequestNumber}`,
              kind: "preview" as const,
            }))
          : affected
              .filter(
                (app) =>
                  stage === "deployment" ||
                  (!isNormalizedResource(app.config) &&
                    (stage === "build" ||
                      Boolean(
                        app.config.hooks[
                          stage === "pre_deploy" ? "preDeploy" : "postDeploy"
                        ],
                      ))),
              )
              .map((app) => ({
                id: app.id,
                name: app.name,
                kind:
                  app.kind === "app" ? ("app" as const) : ("resource" as const),
              })),
      };
    }),
  );
}

export async function updateEnvironmentSecrets(input: {
  owner: SecretOwner;
  environment: string;
  stage: SecretStage;
  mutation: SecretMutation;
  actorUserId: string;
}) {
  const ownership = await getEnvironmentSecretOwner(input.owner);
  if (
    (input.environment === "preview" ||
      input.environment.startsWith("preview:")) &&
    ownership.resource
  )
    throw unprocessable("Resources do not support preview secrets");
  if (ownership.resource && input.stage !== "deployment")
    throw unprocessable("Resources only support runtime secrets");
  return await mutateSecret(
    { ...input.owner, environment: input.environment, stage: input.stage },
    input.mutation,
    input.actorUserId,
    (values) => {
      try {
        validateSecretReferences(
          values,
          input.owner.type === "server" ? "app" : input.owner.type,
        );
      } catch (error) {
        throw unprocessable(
          error instanceof Error ? error.message : "Invalid secret reference",
          "SECRET_REFERENCE_INVALID",
        );
      }
    },
  );
}

export async function resolveEnvironmentStage(
  input: {
    workspaceId: string;
    sourceId: string;
    appId: string;
    environment: string;
    stage: SecretStage;
  },
  database: SecretDatabase = getTowbarDatabase(),
) {
  const slot = {
    workspaceId: input.workspaceId,
    environment: input.environment,
    stage: input.stage,
  };
  const empty = { values: {} as Record<string, string>, revision: null };
  const local = await readSecretValues(
    { ...slot, type: "app", id: input.appId },
    database,
  );
  const shared = secretReferenceDependencies(local.values, {}).shared
    ? await readSecretValues(
        { ...slot, type: "source", id: input.sourceId },
        database,
      )
    : empty;
  const dependencies = secretReferenceDependencies(local.values, shared.values);
  const global = dependencies.global
    ? await readSecretValues({ ...slot, type: "workspace" }, database)
    : empty;
  return {
    values: resolveValues(local.values, global.values, shared.values),
    revisions: {
      [`${input.stage}:local`]: local.revision,
      [`${input.stage}:shared`]: dependencies.shared ? shared.revision : null,
      [`${input.stage}:global`]: dependencies.global ? global.revision : null,
    },
  };
}

function resolveValues(
  local: Record<string, string>,
  global: Record<string, string>,
  shared: Record<string, string>,
) {
  try {
    validateSecretReferences(local, "app");
    return resolveSecretReferences(local, global, shared);
  } catch (error) {
    throw unprocessable(
      error instanceof Error
        ? error.message
        : "Secret references could not be resolved",
      "SECRET_REFERENCE_INVALID",
    );
  }
}
