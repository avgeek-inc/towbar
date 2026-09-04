import { eq } from "drizzle-orm";
import { isNormalizedResource } from "@workspace/towbar-core";
import { deployments } from "@workspace/towbar-database/schema";
import { notFound, unprocessable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { resolveEnvironmentStage } from "../apps/secrets.js";
import { resolveServerCredentials } from "../secrets/store.js";
import { sshLoginSecretSchema } from "../servers/service.js";
import type { SecretStage } from "@workspace/towbar-core";
import type { SecretDatabase } from "../secrets/store.js";

async function getSecretDeployment(
  deploymentId: string,
  database: SecretDatabase = getTowbarDatabase(),
) {
  const [deployment] = await database
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!deployment) throw notFound("Deployment");
  return deployment;
}

export async function resolveDeploymentSecrets(deploymentId: string) {
  return await getTowbarDatabase().transaction(
    async (database) => {
      const deployment = await getSecretDeployment(deploymentId, database);
      const app = deployment.appSnapshot;
      const resource = isNormalizedResource(app);
      const credentials = await resolveServerCredentials(deployment, database);
      const revisions: Record<string, string | null> = {
        credentials: credentials.revision,
      };
      async function stage(stage: SecretStage, required: boolean) {
        if (!required) return {};
        const result = await resolveEnvironmentStage(
          {
            workspaceId: deployment.workspaceId,
            sourceId: deployment.sourceId,
            appId: deployment.appId,
            environment: deployment.environment,
            stage,
          },
          database,
        );
        Object.assign(revisions, result.revisions);
        return result.values;
      }
      const runtime = await stage("deployment", true);
      requireResourcePasswords(resource ? app.kind : undefined, runtime);
      const build = await stage(
        "build",
        !resource && deployment.kind === "deploy",
      );
      const hooks = {
        preDeploy: await stage(
          "pre_deploy",
          !resource &&
            deployment.kind === "deploy" &&
            Boolean(app.hooks.preDeploy),
        ),
        postDeploy: await stage(
          "post_deploy",
          !resource &&
            deployment.kind === "deploy" &&
            Boolean(app.hooks.postDeploy),
        ),
      };
      const cloudflare = cloudflareCredential(
        deployment.serverSnapshot,
        credentials.values,
      );
      await database
        .update(deployments)
        .set({ secretRevisions: revisions })
        .where(eq(deployments.id, deploymentId));
      return {
        build,
        runtime,
        hooks,
        cloudflare,
        login: sshLoginSecretSchema.parse({
          privateKey: credentials.values.privateKey,
        }),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

export async function resolveDeploymentLogin(deploymentId: string) {
  const deployment = await getSecretDeployment(deploymentId);
  const credentials = await resolveServerCredentials(deployment);
  return sshLoginSecretSchema.parse({
    privateKey: credentials.values.privateKey,
  });
}

function cloudflareCredential(
  server: { proxy?: { cloudflare: { enabled: true } } },
  values: Record<string, string>,
) {
  if (!server.proxy?.cloudflare.enabled) return null;
  if (!values.apiToken)
    throw unprocessable(
      "Configure the Cloudflare API token in Server → Settings → Credentials",
      "CLOUDFLARE_CREDENTIALS_MISSING",
    );
  return { apiToken: values.apiToken };
}

export async function resolveDeploymentCloudflareSecret(deploymentId: string) {
  const deployment = await getSecretDeployment(deploymentId);
  return cloudflareCredential(
    deployment.serverSnapshot,
    (await resolveServerCredentials(deployment)).values,
  );
}

export async function resolveRuntimeEnvironmentSecrets(
  input: { appId: string; sourceId: string; workspaceId: string },
  database: SecretDatabase = getTowbarDatabase(),
) {
  return (
    await resolveEnvironmentStage(
      { ...input, environment: "production", stage: "deployment" },
      database,
    )
  ).values;
}

export function requireResourcePasswords(
  kind: string | undefined,
  runtime: Record<string, string>,
) {
  const key =
    kind === "postgres"
      ? "POSTGRES_PASSWORD"
      : kind === "redis"
        ? "REDIS_PASSWORD"
        : null;
  if (key && !runtime[key])
    throw unprocessable(
      `Configure ${key} in Resource → Settings → Secrets`,
      "RESOURCE_PASSWORD_MISSING",
    );
}
