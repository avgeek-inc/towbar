import { eq } from "drizzle-orm";
import { z } from "zod";

import { isNormalizedResource } from "@workspace/towbar-core";
import { deployments } from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { resolveAwsSecret } from "../aws/service.js";
import { sshLoginSecretSchema } from "../servers/service.js";

import type { NormalizedApp } from "@workspace/towbar-core";

const environmentSecretSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u),
  z.string().max(128 * 1_024),
);
const cloudflareSecretSchema = z
  .object({
    apiToken: z
      .string()
      .min(20)
      .regex(/^[A-Za-z0-9_-]+$/u),
  })
  .strict();

type SecretDeployment = {
  sourceId: string;
  workspaceId: string;
};

export async function resolveDeploymentSecrets(deploymentId: string) {
  const deployment = await getSecretDeployment(deploymentId);
  const resource = isNormalizedResource(deployment.app) ? deployment.app : null;
  const application: NormalizedApp | null = resource
    ? null
    : (deployment.app as NormalizedApp);
  const [login, build, runtime, cloudflare, hooks] = await Promise.all([
    resolveLoginSecret(deployment),
    resolveBuildSecrets(deployment, application),
    resolveRuntimeSecrets(deployment),
    resolveCloudflareSecret(deployment),
    resolveHookSecrets(deployment, application),
  ]);
  requireResourcePasswords(resource?.kind, runtime);
  return { build, cloudflare, hooks, login, runtime };
}

async function getSecretDeployment(deploymentId: string) {
  const [deployment] = await getTowbarDatabase()
    .select({
      app: deployments.appSnapshot,
      appId: deployments.appId,
      kind: deployments.kind,
      server: deployments.serverSnapshot,
      sourceId: deployments.sourceId,
      workspaceId: deployments.workspaceId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!deployment) throw notFound("Deployment");
  return deployment;
}

async function resolveLoginSecret(
  deployment: SecretDeployment & {
    server: { secrets: { login: string } };
  },
) {
  return sshLoginSecretSchema.parse(
    await resolveAwsSecret({
      secretReference: deployment.server.secrets.login,
      sourceId: deployment.sourceId,
      workspaceId: deployment.workspaceId,
    }),
  );
}

async function resolveBuildSecrets(
  deployment: SecretDeployment & { kind: "deploy" | "rollback" },
  application: NormalizedApp | null,
) {
  if (deployment.kind !== "deploy" || !application) return {};
  const shared = await resolveSharedEnvironmentSecrets(
    application.sharedSecrets?.build ?? [],
    deployment,
  );
  const app = application.secrets.build
    ? await resolveEnvironmentSecret(application.secrets.build, deployment)
    : {};
  return mergeEnvironmentSecretBundles([shared], app);
}

async function resolveRuntimeSecrets(
  deployment: SecretDeployment & {
    app: {
      secrets: { deployment?: string };
      sharedSecrets?: { deployment: string[] };
    };
  },
) {
  return await resolveRuntimeEnvironmentSecrets({
    app: deployment.app,
    sourceId: deployment.sourceId,
    workspaceId: deployment.workspaceId,
  });
}

export async function resolveRuntimeEnvironmentSecrets(input: {
  app: {
    secrets: { deployment?: string };
    sharedSecrets?: { deployment: string[] };
  };
  sourceId: string;
  workspaceId: string;
}) {
  const shared = await resolveSharedEnvironmentSecrets(
    input.app.sharedSecrets?.deployment ?? [],
    input,
  );
  const deployable = input.app.secrets.deployment
    ? await resolveEnvironmentSecret(input.app.secrets.deployment, input)
    : {};
  return mergeEnvironmentSecretBundles([shared], deployable);
}

async function resolveCloudflareSecret(
  deployment: SecretDeployment & {
    server: { proxy?: { cloudflare: { apiToken: string } } };
  },
) {
  const secretReference = deployment.server.proxy?.cloudflare.apiToken;
  if (!secretReference) return null;
  return cloudflareSecretSchema.parse(
    await resolveAwsSecret({
      secretReference,
      sourceId: deployment.sourceId,
      workspaceId: deployment.workspaceId,
    }),
  );
}

export async function resolveDeploymentCloudflareSecret(deploymentId: string) {
  return await resolveCloudflareSecret(await getSecretDeployment(deploymentId));
}

async function resolveHookSecrets(
  deployment: SecretDeployment & { kind: "deploy" | "rollback" },
  application: NormalizedApp | null,
) {
  if (deployment.kind !== "deploy" || !application) {
    return { postDeploy: {}, preDeploy: {} };
  }
  return {
    postDeploy: await resolveOptionalEnvironmentSecret(
      application.hooks.postDeploy?.secrets,
      deployment,
    ),
    preDeploy: await resolveOptionalEnvironmentSecret(
      application.hooks.preDeploy?.secrets,
      deployment,
    ),
  };
}

async function resolveOptionalEnvironmentSecret(
  secretReference: string | undefined,
  deployment: SecretDeployment,
) {
  return secretReference
    ? await resolveEnvironmentSecret(secretReference, deployment)
    : {};
}

async function resolveEnvironmentSecret(
  secretReference: string,
  deployment: SecretDeployment,
) {
  return environmentSecretSchema.parse(
    await resolveAwsSecret({
      secretReference,
      sourceId: deployment.sourceId,
      workspaceId: deployment.workspaceId,
    }),
  );
}

async function resolveSharedEnvironmentSecrets(
  secretReferences: string[],
  deployment: SecretDeployment,
) {
  const bundles = await Promise.all(
    secretReferences.map((reference) =>
      resolveEnvironmentSecret(reference, deployment),
    ),
  );
  return mergeEnvironmentSecretBundles(bundles);
}

function requireResourcePasswords(
  kind: "image" | "postgres" | "redis" | undefined,
  runtime: Record<string, string>,
) {
  if (kind === "postgres" && !runtime.POSTGRES_PASSWORD) {
    throw new Error(
      "PostgreSQL resources require POSTGRES_PASSWORD in deployment secrets",
    );
  }
  if (kind === "redis" && !runtime.REDIS_PASSWORD) {
    throw new Error(
      "Redis resources require REDIS_PASSWORD in deployment secrets",
    );
  }
}

export function mergeEnvironmentSecretBundles(
  sharedBundles: Array<Record<string, string>>,
  deployableBundle: Record<string, string> = {},
) {
  const merged: Record<string, string> = {};
  for (const bundle of sharedBundles) {
    for (const [key, value] of Object.entries(bundle)) {
      if (Object.hasOwn(merged, key)) {
        throw new Error(
          `Shared secret bundles define duplicate environment key '${key}'`,
        );
      }
      merged[key] = value;
    }
  }
  return { ...merged, ...deployableBundle };
}
