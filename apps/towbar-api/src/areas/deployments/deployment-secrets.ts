import { and, eq } from "drizzle-orm";
import {
  isNormalizedCompose,
  isNormalizedResource,
  requiredKeysForStage,
} from "@workspace/towbar-core";
import { deployments, releases } from "@workspace/towbar-database/schema";
import { notFound, unprocessable } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { instanceSecretEnvironment } from "../apps/instance-environment.js";
import { resolveEnvironmentStage } from "../apps/secrets.js";
import { resolveServerCredentials } from "../secrets/store.js";
import { sshLoginSecretSchema } from "../servers/service.js";
import { resolveIntegration } from "../integrations/service.js";
import type { NormalizedDeployable, SecretStage } from "@workspace/towbar-core";
import type { SecretDatabase } from "../secrets/store.js";
import { resolveExternalSecretSnapshot } from "./external-secret-sources.js";
import { getRuntimeIntegration } from "../../infrastructure/runtime-integrations.js";

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

function tunnelPolicy(app: NormalizedDeployable) {
  if (isNormalizedCompose(app)) {
    const services = Object.values(app.services).filter(
      (service) => service.ingress?.type === "cloudflare-tunnel",
    );
    const ingress = services[0]?.ingress;
    return ingress?.type === "cloudflare-tunnel"
      ? {
          hostnames: services.flatMap((service) => service.domains ?? []),
          ingress,
        }
      : null;
  }
  return app.ingress?.type === "cloudflare-tunnel" && app.domains
    ? {
        hostnames: [
          app.domains.primary,
          ...app.domains.redirects.map((redirect) => redirect.host),
        ],
        ingress: app.ingress,
      }
    : null;
}

export async function resolveDeploymentSecrets(deploymentId: string) {
  return await getTowbarDatabase().transaction(
    // eslint-disable-next-line complexity -- One transaction resolves all mutually dependent runtime, source, build, and ingress credentials.
    async (database) => {
      const deployment = await getSecretDeployment(deploymentId, database);
      const app = deployment.appSnapshot;
      const resource = isNormalizedResource(app);
      const credentials = await resolveServerCredentials(deployment, database);
      const buildCredentials = deployment.buildServerId
        ? await resolveServerCredentials(
            {
              serverId: deployment.buildServerId,
              workspaceId: deployment.workspaceId,
            },
            database,
          ).catch((error) => {
            if (
              !isNormalizedResource(deployment.appSnapshot) &&
              !isNormalizedCompose(deployment.appSnapshot) &&
              deployment.appSnapshot.buildServer?.allowRuntimeFallback
            )
              return null;
            throw error;
          })
        : null;
      const revisions: Record<string, string | null> = {
        credentials: credentials.revision,
        ...(buildCredentials
          ? { buildCredentials: buildCredentials.revision }
          : {}),
      };
      async function stage(stage: SecretStage, required: boolean) {
        if (!required) return {};
        const result = await resolveEnvironmentStage(
          {
            workspaceId: deployment.workspaceId,
            sourceId: deployment.sourceId,
            appId: deployment.appId,
            environment: await instanceSecretEnvironment(
              { ...deployment, preview: deployment.environment === "preview" },
              database,
            ),
            stage,
          },
          database,
        );
        const missing = requiredKeysForStage(
          deployment.requiredSecrets,
          stage,
        ).filter((key) => !Object.hasOwn(result.values, key));
        if (missing.length)
          throw unprocessable(
            `Required secrets missing for deployment (${stage}): ${missing.join(", ")}`,
            "REQUIRED_SECRETS_MISSING",
          );
        Object.assign(revisions, result.revisions);
        return result.values;
      }
      const runtime = await stage("deployment", true);
      const environment = await instanceSecretEnvironment(
        { ...deployment, preview: deployment.environment === "preview" },
        database,
      );
      const target = {
        environment,
        kind: "repository" as const,
        purpose: "secret" as const,
        repositoryId: deployment.sourceId,
      };
      const externalRuntime = await resolveExternalSecretSnapshot({
        deployable: app,
        expectedRevisions: deployment.secretRevisions,
        stage: "runtime",
        target,
        workspaceId: deployment.workspaceId,
      });
      rejectSecretCollisions(runtime, externalRuntime.values, "runtime");
      Object.assign(runtime, externalRuntime.values);
      Object.assign(revisions, externalRuntime.revisions);
      requireResourcePasswords(resource ? app.kind : undefined, runtime);
      const build = await stage(
        "build",
        !resource && deployment.kind === "deploy",
      );
      if (!resource && deployment.kind === "deploy") {
        const externalBuild = await resolveExternalSecretSnapshot({
          deployable: app,
          expectedRevisions: deployment.secretRevisions,
          stage: "build",
          target,
          workspaceId: deployment.workspaceId,
        });
        rejectSecretCollisions(build, externalBuild.values, "build");
        Object.assign(build, externalBuild.values);
        Object.assign(revisions, externalBuild.revisions);
      }
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
      const cloudflare = cloudflareCredential(deployment.serverSnapshot);
      const currentTunnelPolicy = tunnelPolicy(app);
      const tunnelIngress = currentTunnelPolicy?.ingress ?? null;
      const tunnel = currentTunnelPolicy
        ? await resolveIntegration({
            expectedRevision: undefined,
            providers: ["cloudflare"],
            slug: currentTunnelPolicy.ingress.integration,
            target: {
              environment,
              kind: "repository",
              purpose: "ingress",
              repositoryId: deployment.sourceId,
            },
            workspaceId: deployment.workspaceId,
          })
        : null;
      const tunnelInput = tunnel?.connectionInput;
      if (tunnelInput && tunnelInput.provider !== "cloudflare")
        throw new Error("Tunnel reference resolved an incompatible provider");
      if (tunnel)
        revisions[`integration:${tunnel.connection.slug}`] = String(
          tunnel.connection.revision,
        );
      const [previousRelease] = await database
        .select({ deploymentId: releases.deploymentId })
        .from(releases)
        .where(
          and(
            eq(releases.appId, deployment.appId),
            eq(releases.status, "current"),
            eq(releases.environment, deployment.environment),
            ...(deployment.environment === "preview"
              ? [
                  eq(
                    releases.previewEnvironmentId,
                    deployment.previewEnvironmentId!,
                  ),
                ]
              : []),
          ),
        )
        .limit(1);
      const previousDeployment = previousRelease
        ? await getSecretDeployment(previousRelease.deploymentId, database)
        : null;
      const previousTunnelPolicy = previousDeployment
        ? tunnelPolicy(previousDeployment.appSnapshot)
        : null;
      let previousCloudflareTunnelCleanupBlocked = false;
      const previousTunnel = previousTunnelPolicy
        ? previousTunnelPolicy.ingress.integration ===
            tunnelIngress?.integration && tunnel
          ? tunnel
          : await resolveIntegration({
              expectedRevision: undefined,
              providers: ["cloudflare"],
              slug: previousTunnelPolicy.ingress.integration,
              target: {
                environment,
                kind: "repository",
                purpose: "ingress",
                repositoryId: deployment.sourceId,
              },
              workspaceId: deployment.workspaceId,
            }).catch(() => {
              previousCloudflareTunnelCleanupBlocked = true;
              return null;
            })
        : null;
      const previousTunnelInput = previousTunnel?.connectionInput;
      if (previousTunnelInput && previousTunnelInput.provider !== "cloudflare")
        throw new Error("Previous tunnel resolved an incompatible provider");
      if (previousTunnel)
        revisions[`integration:${previousTunnel.connection.slug}`] = String(
          previousTunnel.connection.revision,
        );
      const registrySlug =
        !resource && deployment.kind === "deploy"
          ? app.deployment?.type === "image" && app.deployment.registry
            ? app.deployment.registry
            : !isNormalizedCompose(app) &&
                app.buildServer?.transfer === "registry"
              ? app.buildServer.registry
              : undefined
          : undefined;
      const registry = registrySlug
        ? await resolveIntegration({
            expectedRevision: undefined,
            providers: ["registry"],
            slug: registrySlug,
            target: {
              environment: deployment.targetEnvironment.name,
              kind: "repository",
              purpose: "image",
              repositoryId: deployment.sourceId,
            },
            workspaceId: deployment.workspaceId,
          })
        : null;
      const registryInput = registry?.connectionInput;
      if (registryInput && registryInput.provider !== "registry")
        throw new Error("Registry reference resolved an incompatible provider");
      if (registry)
        revisions[`integration:${registry.connection.slug}`] = String(
          registry.connection.revision,
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
        cloudflareTunnel:
          tunnelInput?.provider === "cloudflare" && tunnelIngress
            ? {
                accountId: tunnelInput.configuration.accountId,
                access: tunnelIngress.access,
                apiToken: tunnelInput.credentials.apiToken,
                image: tunnelInput.configuration.cloudflaredImage,
                integration: tunnelIngress.integration,
                ...(tunnelIngress.tunnel
                  ? { tunnelName: tunnelIngress.tunnel }
                  : {}),
                ...(tunnelInput.configuration.zoneId
                  ? { zoneId: tunnelInput.configuration.zoneId }
                  : {}),
              }
            : null,
        previousCloudflareTunnel:
          previousTunnelInput?.provider === "cloudflare" && previousTunnelPolicy
            ? {
                accountId: previousTunnelInput.configuration.accountId,
                apiToken: previousTunnelInput.credentials.apiToken,
                hostnames: previousTunnelPolicy.hostnames,
                integration: previousTunnelPolicy.ingress.integration,
                ...(previousTunnelPolicy.ingress.tunnel
                  ? { tunnelName: previousTunnelPolicy.ingress.tunnel }
                  : {}),
                ...(previousTunnelInput.configuration.zoneId
                  ? { zoneId: previousTunnelInput.configuration.zoneId }
                  : {}),
              }
            : null,
        previousCloudflareTunnelCleanupBlocked,
        registry:
          registryInput?.provider === "registry"
            ? {
                password: registryInput.credentials.password,
                server: registryInput.configuration.registry,
                username: registryInput.credentials.username,
              }
            : null,
        login: sshLoginSecretSchema.parse({
          privateKey: credentials.values.privateKey,
        }),
        ...(buildCredentials
          ? {
              buildLogin: sshLoginSecretSchema.parse({
                privateKey: buildCredentials.values.privateKey,
              }),
            }
          : {}),
      };
    },
    { isolationLevel: "repeatable read" },
  );
}

function rejectSecretCollisions(
  managed: Record<string, string>,
  external: Record<string, string>,
  stage: string,
) {
  const collisions = Object.keys(external).filter((key) =>
    Object.hasOwn(managed, key),
  );
  if (collisions.length)
    throw unprocessable(
      `External ${stage} secrets conflict with Towbar-managed secrets: ${collisions.join(", ")}`,
      "SECRET_SOURCE_CONFLICT",
    );
}

export async function resolveDeploymentLogin(deploymentId: string) {
  const deployment = await getSecretDeployment(deploymentId);
  const credentials = await resolveServerCredentials(deployment);
  return sshLoginSecretSchema.parse({
    privateKey: credentials.values.privateKey,
  });
}

function cloudflareCredential(server: {
  proxy?: { cloudflare: { enabled: true } };
}) {
  if (!server.proxy?.cloudflare.enabled) return null;
  const connection = getRuntimeIntegration("cloudflare");
  if (!connection || connection.provider !== "cloudflare")
    throw unprocessable(
      "Enable the Cloudflare integration in the Towbar environment",
      "CLOUDFLARE_CREDENTIALS_MISSING",
    );
  return { apiToken: connection.credentials.apiToken };
}

export async function resolveDeploymentCloudflareSecret(deploymentId: string) {
  const deployment = await getSecretDeployment(deploymentId);
  return cloudflareCredential(deployment.serverSnapshot);
}

export async function resolveDeploymentCloudflareTunnelSecret(
  deploymentId: string,
) {
  const deployment = await getSecretDeployment(deploymentId);
  const app = deployment.appSnapshot;
  const tunnelIngress = isNormalizedCompose(app)
    ? Object.values(app.services)
        .map((service) => service.ingress)
        .find((ingress) => ingress?.type === "cloudflare-tunnel")
    : app.ingress;
  if (tunnelIngress?.type !== "cloudflare-tunnel") return null;
  const environment = await instanceSecretEnvironment({
    ...deployment,
    preview: deployment.environment === "preview",
  });
  const resolved = await resolveIntegration({
    expectedRevision: undefined,
    providers: ["cloudflare"],
    slug: tunnelIngress.integration,
    target: {
      environment,
      kind: "repository",
      purpose: "ingress",
      repositoryId: deployment.sourceId,
    },
    workspaceId: deployment.workspaceId,
  });
  if (resolved.connectionInput.provider !== "cloudflare")
    throw new Error("Tunnel reference resolved an incompatible provider");
  return {
    accountId: resolved.connectionInput.configuration.accountId,
    apiToken: resolved.connectionInput.credentials.apiToken,
    ...(tunnelIngress.tunnel ? { tunnelName: tunnelIngress.tunnel } : {}),
    ...(resolved.connectionInput.configuration.zoneId
      ? { zoneId: resolved.connectionInput.configuration.zoneId }
      : {}),
  };
}

export async function resolveRuntimeEnvironmentSecrets(
  input: { appId: string; sourceId: string; workspaceId: string },
  database: SecretDatabase = getTowbarDatabase(),
) {
  return (
    await resolveEnvironmentStage(
      {
        ...input,
        environment: await instanceSecretEnvironment(input, database),
        stage: "deployment",
      },
      database,
    )
  ).values;
}

export function requireResourcePasswords(
  kind: string | undefined,
  runtime: Record<string, string>,
) {
  const keys = {
    clickhouse: ["CLICKHOUSE_USER", "CLICKHOUSE_PASSWORD"],
    dragonfly: ["REDIS_PASSWORD"],
    keydb: ["REDIS_PASSWORD"],
    mariadb: ["MYSQL_ROOT_PASSWORD"],
    mongodb: ["MONGO_INITDB_ROOT_USERNAME", "MONGO_INITDB_ROOT_PASSWORD"],
    mysql: ["MYSQL_ROOT_PASSWORD"],
    postgres: ["POSTGRES_PASSWORD"],
    redis: ["REDIS_PASSWORD"],
  }[kind ?? ""];
  const missing = keys?.filter((key) => !runtime[key]) ?? [];
  if (missing.length > 0)
    throw unprocessable(
      `Configure ${missing.join(", ")} in Resource → Settings → Secrets`,
      "RESOURCE_PASSWORD_MISSING",
    );
}
