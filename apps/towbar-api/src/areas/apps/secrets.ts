import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  isNormalizedResource,
  mergeSecretValues,
  secretStages,
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
  environment: "production" | "preview",
) {
  const ownership = await getEnvironmentSecretOwner(owner);
  if (environment === "preview" && (owner.type !== "app" || ownership.resource))
    throw unprocessable("Only apps have preview secrets");
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
    owner.type === "app" && environment === "preview"
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
              eq(deployments.environment, environment),
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
      const shared =
        owner.type === "app" && environment === "production"
          ? await readSecretMetadata({
              workspaceId: owner.workspaceId,
              type: "source",
              id: ownership.sourceId!,
              environment,
              stage,
            })
          : { keys: [], revision: null, updatedAt: null };
      return {
        stage,
        environment,
        ...local,
        inheritedKeys: shared.keys,
        inheritedRevision: shared.revision,
        pendingChanges:
          owner.type === "app" &&
          (environment === "preview" && previewTargets.length
            ? previewTargets.some(
                (preview) =>
                  local.revision !==
                  (successfulDeployments.find(
                    (deployment) => deployment.previewId === preview.id,
                  )?.revisions?.[`${stage}:local`] ?? null),
              )
            : local.revision !==
                (successfulDeployments[0]?.revisions?.[`${stage}:local`] ??
                  null) ||
              shared.revision !==
                (successfulDeployments[0]?.revisions?.[`${stage}:shared`] ??
                  null)),
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
  environment: "production" | "preview";
  stage: SecretStage;
  mutation: SecretMutation;
  actorUserId: string;
}) {
  const ownership = await getEnvironmentSecretOwner(input.owner);
  if (
    input.environment === "preview" &&
    (input.owner.type !== "app" || ownership.resource)
  )
    throw unprocessable("Only apps have preview secrets");
  if (ownership.resource && input.stage !== "deployment")
    throw unprocessable("Resources only support runtime secrets");
  return await mutateSecret(
    { ...input.owner, environment: input.environment, stage: input.stage },
    input.mutation,
    input.actorUserId,
  );
}

export async function resolveEnvironmentStage(
  input: {
    workspaceId: string;
    sourceId: string;
    appId: string;
    environment: "production" | "preview";
    stage: SecretStage;
  },
  database: SecretDatabase = getTowbarDatabase(),
) {
  const shared =
    input.environment === "production"
      ? await readSecretValues(
          {
            type: "source",
            id: input.sourceId,
            workspaceId: input.workspaceId,
            environment: "production",
            stage: input.stage,
          },
          database,
        )
      : { values: {}, revision: null };
  const local = await readSecretValues(
    {
      type: "app",
      id: input.appId,
      workspaceId: input.workspaceId,
      environment: input.environment,
      stage: input.stage,
    },
    database,
  );
  return {
    values: mergeSecretValues(shared.values, local.values),
    revisions: {
      [`${input.stage}:local`]: local.revision,
      [`${input.stage}:shared`]: shared.revision,
    },
  };
}
