import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { pathToFileURL } from "node:url";

import type {
  App,
  AwsCredentialMetadata,
  Deployment,
  DeploymentEvent,
  DeploymentLog,
  DeploymentState,
  DeploymentStep,
  GitHubConnection,
  GitHubRepository,
  OrphanItem,
  Release,
  Resource,
  ResourceOperation,
  Server,
  ServerCheck,
  ServerPreparation,
  Source,
  SourceBackup,
  SourceSync,
  TowbarUser,
  TrustedHostKey,
  UserSession,
} from "@workspace/towbar-web-client";

export const fixtureIds = {
  app: "31111111-1111-4111-8111-222222222222",
  deployment: "61111111-1111-4111-8111-111111111111",
  imageResource: "41111111-1111-4111-8111-444444444444",
  resource: "41111111-1111-4111-8111-111111111111",
  secondaryPostgres: "41111111-1111-4111-8111-333333333333",
  secondaryServer: "21111111-1111-4111-8111-222222222222",
  server: "21111111-1111-4111-8111-111111111111",
  source: "11111111-1111-4111-8111-111111111111",
  sync: "91111111-1111-4111-8111-111111111111",
} as const;

type FixtureApp = App & {
  serverId: string;
};

type FixtureResource = Resource & {
  serverId: string;
  serverSsh: { port: number; username: string };
};

const fixtureNow = "2026-08-22T09:00:00.000Z";
const commitSha = "c".repeat(40);
const manifestDigest = "d".repeat(64);
const terminalStates = new Set<DeploymentState>([
  "cancelled",
  "failed",
  "skipped",
  "succeeded",
  "succeeded_with_warnings",
]);

const user: TowbarUser = {
  email: "owner@example.com",
  id: "71111111-1111-4111-8111-111111111111",
  name: "Towbar Owner",
  workspaceId: "81111111-1111-4111-8111-111111111111",
  workspaceRole: "owner",
};

const source: Source = {
  branch: "main",
  createdAt: fixtureNow,
  id: fixtureIds.source,
  latestCommitSha: commitSha,
  latestManifestDigest: manifestDigest,
  repositoryName: "platform",
  repositoryOwner: "example-inc",
  status: "active",
  updatedAt: fixtureNow,
};

const servers: Server[] = [
  createServerFixture(fixtureIds.server, "192.0.2.10", "ubuntu", false),
  createServerFixture(fixtureIds.secondaryServer, "192.0.2.11", "deploy", true),
];

const apps: FixtureApp[] = [
  createAppFixture(
    "31111111-1111-4111-8111-111111111111",
    "Towbar API",
    "towbar-api",
    servers[0]!,
    "unhealthy",
  ),
  createAppFixture(
    fixtureIds.app,
    "Example Website",
    "example-website",
    servers[1]!,
  ),
  createAppFixture(
    "31111111-1111-4111-8111-333333333333",
    "Example Admin",
    "example-admin",
    servers[1]!,
  ),
];

const resources: FixtureResource[] = [
  createResourceFixture(
    fixtureIds.resource,
    "Primary Postgres",
    "primary-postgres",
    "postgres",
    servers[0]!,
  ),
  createResourceFixture(
    "41111111-1111-4111-8111-222222222222",
    "Application Redis",
    "application-redis",
    "redis",
    servers[1]!,
  ),
  createResourceFixture(
    fixtureIds.secondaryPostgres,
    "Analytics Postgres",
    "analytics-postgres",
    "postgres",
    servers[1]!,
  ),
  createResourceFixture(
    fixtureIds.imageResource,
    "Mailpit",
    "mailpit",
    "image",
    servers[1]!,
  ),
];

const deployments: Deployment[] = [
  createDeploymentFixture(
    fixtureIds.deployment,
    apps[1]!,
    servers[1]!,
    "building",
  ),
  createDeploymentFixture(
    "61111111-1111-4111-8111-222222222222",
    resources[0]!,
    servers[0]!,
    "checking_health",
  ),
  createDeploymentFixture(
    "61111111-1111-4111-8111-333333333333",
    apps[2]!,
    servers[1]!,
    "queued",
  ),
  ...Array.from({ length: 14 }, (_, index) => {
    const deployable = apps[index % apps.length]!;
    const server = servers.find(
      (item) => item.canonicalIp === deployable.serverIp,
    )!;
    const createdAt = new Date(
      Date.parse(fixtureNow) - (13 - index) * 86_400_000,
    ).toISOString();
    return createDeploymentFixture(
      `51111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      deployable,
      server,
      index % 5 === 0 ? "failed" : "succeeded",
      createdAt,
      index % 7 === 0 ? "rollback" : index % 2 === 0 ? "auto_deploy" : "manual",
    );
  }),
  ...Array.from({ length: 12 }, (_, index) => {
    const createdAt = new Date(
      Date.parse(fixtureNow) - (index + 1) * 43_200_000,
    ).toISOString();
    return createDeploymentFixture(
      `52111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      resources[0]!,
      servers[0]!,
      index % 6 === 0 ? "failed" : "succeeded",
      createdAt,
      index % 3 === 0 ? "auto_deploy" : index % 5 === 0 ? "rollback" : "manual",
    );
  }),
];

const releases: Release[] = [...apps, ...resources].map(
  (deployable, index) => ({
    appId: deployable.id,
    commitSha,
    containerName: `towbar-${deployable.manifestId}`,
    deploymentId:
      deployments.find((item) => item.appId === deployable.id)?.id ??
      deployments[0]!.id,
    id: `a1111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    imageTag: `towbar/${deployable.manifestId}:${commitSha.slice(0, 12)}`,
    promotedAt: fixtureNow,
    status: "current",
    supersededAt: null,
  }),
);

const sourceSync: SourceSync = {
  commitSha,
  createdAt: fixtureNow,
  finishedAt: fixtureNow,
  id: fixtureIds.sync,
  issues: [],
  manifestDigest,
  reconciliation: { apps: 3, resources: 2, servers: 2 },
  startedAt: fixtureNow,
  status: "succeeded",
};

const awsCredential: AwsCredentialMetadata = {
  accessKeyIdSuffix: "ABCD",
  createdAt: fixtureNow,
  lastVerifiedAt: fixtureNow,
  region: "ap-south-1",
  status: "verified",
  updatedAt: fixtureNow,
  verificationMessage: null,
};

const githubConnection: GitHubConnection = {
  accountLogin: "example-inc",
  accountType: "Organization",
  id: "b1111111-1111-4111-8111-111111111111",
  installationId: "12345678",
  suspendedAt: null,
  updatedAt: fixtureNow,
};

const githubRepositories: GitHubRepository[] = [
  {
    defaultBranch: "main",
    fullName: "example-inc/platform",
    id: "10001",
    name: "platform",
    owner: "example-inc",
    private: true,
  },
  {
    defaultBranch: "main",
    fullName: "example-inc/example-service",
    id: "10002",
    name: "example-service",
    owner: "example-inc",
    private: true,
  },
];

const discoveredHostKey = {
  algorithm: "ssh-ed25519",
  fingerprint: "SHA256:TowbarFixtureHostKey",
  publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITowbarFixtureHostKey",
};

const hostKeysByServer = new Map<string, TrustedHostKey[]>([
  [fixtureIds.server, []],
  [
    fixtureIds.secondaryServer,
    [
      {
        algorithm: "ssh-ed25519",
        createdAt: fixtureNow,
        fingerprint: "SHA256:TowbarFixtureTrustedHostKey",
        id: "c1111111-1111-4111-8111-222222222222",
      },
    ],
  ],
]);

const userSessions: UserSession[] = [
  {
    createdAt: fixtureNow,
    expiresAt: "2026-09-21T09:00:00.000Z",
    id: "d1111111-1111-4111-8111-111111111111",
    lastSeenAt: fixtureNow,
    revokedAt: null,
  },
  {
    createdAt: "2026-08-20T09:00:00.000Z",
    expiresAt: "2026-09-19T09:00:00.000Z",
    id: "d1111111-1111-4111-8111-222222222222",
    lastSeenAt: "2026-08-22T08:30:00.000Z",
    revokedAt: null,
  },
];

const serverChecks: ServerCheck[] = [
  {
    createdAt: fixtureNow,
    errorCode: "HOST_KEY_NOT_TRUSTED",
    errorMessage: "The server SSH host key has not been explicitly trusted",
    finishedAt: fixtureNow,
    id: "f1111111-1111-4111-8111-000000000000",
    result: { discoveredHostKeys: [discoveredHostKey] },
    startedAt: fixtureNow,
    status: "failed",
  },
  {
    createdAt: fixtureNow,
    errorCode: null,
    errorMessage: null,
    finishedAt: fixtureNow,
    id: "f1111111-1111-4111-8111-111111111111",
    result: {
      architecture: "x86_64",
      dockerVersion: "28.3.3",
      operatingSystem: "Ubuntu 24.04 LTS",
    },
    startedAt: fixtureNow,
    status: "succeeded",
  },
];

const serverPreparationsByServer = new Map<string, ServerPreparation[]>([
  [fixtureIds.server, []],
  [fixtureIds.secondaryServer, [createPreparationFixture("succeeded")]],
]);

const runtimeOperations: ResourceOperation[] = [
  {
    createdAt: fixtureNow,
    deletedAt: null,
    errorCode: null,
    errorMessage: null,
    finishedAt: fixtureNow,
    id: "e1111111-1111-4111-8111-111111111111",
    request: { tail: 500, type: "capture_logs" },
    requestedBy: user.id,
    resourceId: fixtureIds.app,
    result: {
      logs: "Listening on port 3000\nHealth check passed\n",
      truncated: false,
    },
    serverId: fixtureIds.server,
    sourceId: fixtureIds.source,
    startedAt: fixtureNow,
    state: "succeeded",
    type: "capture_logs",
    updatedAt: fixtureNow,
  },
];
const sourceBackups: SourceBackup[] = [
  createBackupFixture(
    "f1111111-1111-4111-8111-111111111111",
    resources[0]!,
    "2026-08-22T08:42:00.000Z",
    248_512_336,
  ),
  createBackupFixture(
    "f1111111-1111-4111-8111-222222222222",
    resources[2]!,
    "2026-08-21T18:15:00.000Z",
    231_902_104,
  ),
];
const orphanItems: OrphanItem[] = [];

const workflowStates: DeploymentState[] = [
  "queued",
  "waiting_for_server",
  "preparing",
  "validating_credentials",
  "checking_server",
  "fetching_source",
  "resolving_secrets",
  "transferring",
  "building",
  "running_pre_deploy",
  "starting_candidate",
  "checking_health",
  "configuring_routing",
  "provisioning_tls",
  "checking_public_endpoint",
  "switching_traffic",
  "running_post_deploy",
  "cleaning_up",
];

export function createFixtureApiServer() {
  return createServer((request, response) => {
    setCorsHeaders(response, request.headers.origin);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const path = requestUrl.pathname;
    if (request.method === "POST" && path === "/v1/core/sources") {
      return writeJson(response, 201, { source });
    }
    if (
      request.method === "POST" &&
      path === `/v1/core/sources/${source.id}/actions/sync`
    ) {
      return writeJson(response, 202, { sync: { id: sourceSync.id } });
    }
    if (
      request.method === "POST" &&
      path === `/v1/core/servers/${fixtureIds.server}/host-keys/actions/trust`
    ) {
      const hostKeys = hostKeysByServer.get(fixtureIds.server)!;
      if (
        !hostKeys.some(
          (key) => key.fingerprint === discoveredHostKey.fingerprint,
        )
      ) {
        hostKeys.push({
          algorithm: discoveredHostKey.algorithm,
          createdAt: new Date().toISOString(),
          fingerprint: discoveredHostKey.fingerprint,
          id: "c1111111-1111-4111-8111-111111111111",
        });
      }
      const failedCheckIndex = serverChecks.findIndex(
        (check) => check.errorCode === "HOST_KEY_NOT_TRUSTED",
      );
      if (failedCheckIndex >= 0) serverChecks.splice(failedCheckIndex, 1);
      return writeJson(response, 201, { hostKey: hostKeys[0] });
    }
    const prepareServerMatch = path.match(
      /^\/v1\/core\/servers\/([^/]+)\/actions\/prepare$/,
    );
    if (request.method === "POST" && prepareServerMatch) {
      const server = servers.find((item) => item.id === prepareServerMatch[1]);
      if (!server) return writeNotFound(response);
      if (!(hostKeysByServer.get(server.id)?.length ?? 0)) {
        return writeJson(response, 409, {
          error: {
            message: "Trust an SSH host key before preparing this server",
          },
        });
      }
      const preparation = createPreparationFixture("succeeded");
      server.preparedAt = preparation.finishedAt;
      server.setupStatus = "ready";
      serverPreparationsByServer.set(server.id, [preparation]);
      for (const deployable of [...apps, ...resources]) {
        if (deployable.serverId === server.id) deployable.serverReady = true;
      }
      return writeJson(response, 202, { preparation });
    }
    const runtimeActionMatch = path.match(
      /^\/v1\/core\/(apps|resources)\/([^/]+)\/actions\/(backup|logs|restart|start|stop)$/,
    );
    if (request.method === "POST" && runtimeActionMatch) {
      const [, kind, deployableId, requestedAction] = runtimeActionMatch;
      const deployable =
        kind === "apps"
          ? apps.find((item) => item.id === deployableId)
          : resources.find((item) => item.id === deployableId);
      if (!deployable) return writeNotFound(response);
      const now = new Date().toISOString();
      const type =
        requestedAction === "backup"
          ? "backup"
          : requestedAction === "logs"
            ? "capture_logs"
            : requestedAction === "restart"
              ? "restart"
              : requestedAction === "start"
                ? "start"
                : requestedAction === "stop"
                  ? "stop"
                  : undefined;
      if (!type) return writeNotFound(response);
      const operation = {
        createdAt: now,
        deletedAt: null,
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
        id: randomUUID(),
        request: { type },
        requestedBy: user.id,
        resourceId: deployable.id,
        result:
          type === "backup"
            ? sourceBackups[0]!.result
            : type === "capture_logs"
              ? {
                  logs: "Listening on port 3000\nHealth check passed\n",
                  truncated: false,
                }
              : { state: type === "stop" ? "stopped" : "running" },
        serverId: deployable.serverId,
        sourceId: deployable.sourceId,
        startedAt: now,
        state: "succeeded",
        type,
        updatedAt: now,
      } satisfies ResourceOperation;
      runtimeOperations.unshift(operation);
      return writeJson(response, 202, { operation });
    }
    const eventMatch = path.match(/^\/v1\/core\/deployments\/([^/]+)\/events$/);
    if (eventMatch) {
      const deployment = deployments.find((item) => item.id === eventMatch[1]);
      if (!deployment) return writeNotFound(response);
      return writeDeploymentEvents(response, deployment);
    }

    const payload = getFixturePayload(path, requestUrl.searchParams);
    if (payload === undefined) return writeNotFound(response);
    writeJson(response, 200, payload);
  });
}

function getFixturePayload(
  path: string,
  searchParams: URLSearchParams,
): unknown {
  const fixedPayloads = new Map<string, unknown>([
    ["/v1/core/session", { user }],
    ["/v1/core/profile", { user }],
    [
      "/v1/core/sessions",
      { currentSessionId: userSessions[0]!.id, sessions: userSessions },
    ],
    ["/v1/core/github", { connection: githubConnection }],
    ["/v1/core/github/repositories", { repositories: githubRepositories }],
    ["/v1/core/sources", { sources: [source] }],
    ["/v1/core/apps", { apps }],
    ["/v1/core/resources", { resources }],
    ["/v1/core/servers", { servers }],
    ["/v1/core/deployments", { deployments }],
    [`/v1/core/sources/${source.id}`, { canManageSource: true, source }],
    [
      `/v1/core/sources/${source.id}/manifest`,
      {
        manifest: {
          commitSha,
          manifest: { apps: [], resources: [], servers: [], version: 1 },
          manifestDigest,
          rawManifest: "version: 1\nservers: []\napps: []\nresources: []\n",
        },
      },
    ],
    [`/v1/core/sources/${source.id}/syncs`, { syncs: [sourceSync] }],
    [`/v1/core/sources/${source.id}/aws`, { credential: awsCredential }],
    [`/v1/core/sources/${source.id}/apps`, { apps }],
    [`/v1/core/sources/${source.id}/resources`, { resources }],
    [
      `/v1/core/sources/${source.id}/servers`,
      {
        servers: servers.map((server) => ({
          ...server,
          hostKeyStatus:
            (hostKeysByServer.get(server.id)?.length ?? 0) > 0 &&
            !(
              server.id === fixtureIds.server &&
              serverChecks[0]?.errorCode === "HOST_KEY_NOT_TRUSTED"
            )
              ? "trusted"
              : "untrusted",
        })),
      },
    ],
    [`/v1/core/sources/${source.id}/deployments`, { deployments }],
    [`/v1/core/sources/${source.id}/backups`, { backups: sourceBackups }],
    [
      `/v1/core/sources/${source.id}/syncs/${sourceSync.id}`,
      { sync: sourceSync },
    ],
  ]);
  const fixed = fixedPayloads.get(path);
  if (fixed !== undefined) return fixed;

  const deploymentMatch = path.match(
    /^\/v1\/core\/deployments\/([^/]+)(?:\/(steps|logs))?$/,
  );
  if (deploymentMatch) {
    const deployment = deployments.find(
      (item) => item.id === deploymentMatch[1],
    );
    if (!deployment) return undefined;
    if (deploymentMatch[2] === "steps") {
      return { steps: getDeploymentSteps(deployment) };
    }
    if (deploymentMatch[2] === "logs") {
      return { logs: getDeploymentLogs(deployment) };
    }
    return { deployment };
  }

  const deployableMatch = path.match(
    /^\/v1\/core\/(apps|resources)\/([^/]+)(?:\/(deployments|releases|operations))?$/,
  );
  if (deployableMatch) {
    const [kind, id, child] = deployableMatch.slice(1);
    const deployable =
      kind === "apps"
        ? apps.find((item) => item.id === id)
        : resources.find((item) => item.id === id);
    if (!deployable) return undefined;
    if (child === "deployments") {
      return {
        deployments: deployments.filter((item) => item.appId === id),
      };
    }
    if (child === "releases") {
      return { releases: releases.filter((item) => item.appId === id) };
    }
    if (child === "operations") return { operations: runtimeOperations };
    return kind === "apps" ? { app: deployable } : { resource: deployable };
  }

  const serverMatch = path.match(
    /^\/v1\/core\/servers\/([^/]+)(?:\/(apps|resources|deployments|checks|host-keys|orphans|preparations))?$/,
  );
  if (serverMatch) {
    const server = servers.find((item) => item.id === serverMatch[1]);
    if (!server) return undefined;
    const child = serverMatch[2];
    if (child === "apps") {
      return {
        apps: apps.filter((item) => item.serverIp === server.canonicalIp),
      };
    }
    if (child === "resources") {
      return {
        resources: resources.filter(
          (item) => item.serverIp === server.canonicalIp,
        ),
      };
    }
    if (child === "deployments") {
      return {
        deployments: deployments.filter((item) => item.serverId === server.id),
      };
    }
    if (child === "checks") {
      const page = readPositiveInteger(searchParams.get("page"), 1);
      const limit = Math.min(
        100,
        readPositiveInteger(searchParams.get("limit"), 10),
      );
      const total = serverChecks.length;
      const offset = (page - 1) * limit;
      return {
        checks: serverChecks.slice(offset, offset + limit),
        latestCheck: serverChecks[0] ?? null,
        pagination: {
          limit,
          page,
          total,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
    if (child === "preparations") {
      return {
        preparations: serverPreparationsByServer.get(server.id) ?? [],
      };
    }
    if (child === "host-keys") {
      return { hostKeys: hostKeysByServer.get(server.id) ?? [] };
    }
    if (child === "orphans") return { orphans: orphanItems };
    return { canCleanupOrphans: true, server };
  }

  return undefined;
}

function readPositiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createServerFixture(
  id: string,
  canonicalIp: string,
  username: string,
  ready: boolean,
): Server {
  return {
    archivedAt: null,
    canonicalIp,
    config: {
      buildConcurrency: 2,
      ip: canonicalIp,
      ssh: { port: 22, username },
    },
    createdAt: fixtureNow,
    id,
    preparedAt: ready ? fixtureNow : null,
    setupStatus: ready ? "ready" : "pending",
    sourceId: source.id,
    sourceRevision: commitSha,
    updatedAt: fixtureNow,
  };
}

function createRuntimeState(
  healthStatus: App["runtimeState"]["healthStatus"],
): App["runtimeState"] {
  const unhealthy = healthStatus === "unhealthy";
  return {
    checkedAt: fixtureNow,
    desiredState: "running",
    driftReasons: unhealthy ? ["Health check is failing"] : [],
    driftStatus: unhealthy ? "drifted" : "in_sync",
    healthStatus,
    observedContainerName: "fixture",
    observedImage: "fixture:latest",
    observedState: "running",
  };
}

function createAppFixture(
  id: string,
  name: string,
  manifestId: string,
  server: Server,
  healthStatus: App["runtimeState"]["healthStatus"] = "healthy",
): FixtureApp {
  return {
    archivedAt: null,
    config: {
      autoDeploy: true,
      container: {
        network: "towbar-fixture",
        port: 3000,
        resources: { cpus: 1, memory: "1g" },
      },
      description: `${name} fixture`,
      dockerfile: `apps/${manifestId}/Dockerfile`,
      health: { path: "/health", timeoutSeconds: 30 },
      id: manifestId,
      name,
      server: server.canonicalIp,
    },
    description: `${name} fixture`,
    id,
    kind: "app",
    manifestId,
    name,
    runtimeState: createRuntimeState(healthStatus),
    serverReady: server.setupStatus === "ready",
    serverId: server.id,
    serverIp: server.canonicalIp,
    sourceId: source.id,
    sourceRevision: commitSha,
    updatedAt: fixtureNow,
  };
}

function createResourceFixture(
  id: string,
  name: string,
  manifestId: string,
  kind: Resource["kind"],
  server: Server,
): FixtureResource {
  return {
    archivedAt: null,
    config: {
      access:
        kind === "postgres"
          ? {
              sshTunnel: {
                hostPort:
                  id === fixtureIds.resource
                    ? 15_432
                    : id === fixtureIds.secondaryPostgres
                      ? 15_433
                      : 15_434,
              },
            }
          : undefined,
      autoDeploy: true,
      backup:
        kind === "postgres"
          ? {
              retention: { keepLast: 7 },
              s3: {
                bucket: "towbar-fixture-backups",
                encryption: "AES256",
                prefix: manifestId,
                region: "ap-south-1",
              },
              schedule: { cron: "0 2 * * *", timezone: "UTC" },
            }
          : undefined,
      container: {
        command: [],
        network: "towbar-fixture",
        networkAlias: manifestId,
        port: kind === "postgres" ? 5432 : kind === "redis" ? 6379 : 8025,
        resources: { cpus: 1, memory: "1g" },
        volumes: [{ mountPath: "/data", name: `${manifestId}-data` }],
      },
      description: `${name} fixture`,
      health: { timeoutSeconds: 30, type: "container" },
      id: manifestId,
      image:
        kind === "postgres"
          ? "postgres:17"
          : kind === "redis"
            ? "redis:8"
            : "axllent/mailpit:v1.27",
      kind,
      name,
      server: server.canonicalIp,
    },
    description: `${name} fixture`,
    id,
    kind,
    manifestId,
    name,
    runtimeState: createRuntimeState("healthy"),
    serverReady: server.setupStatus === "ready",
    serverId: server.id,
    serverIp: server.canonicalIp,
    serverSsh: {
      port: server.config.ssh.port,
      username: server.config.ssh.username,
    },
    sourceId: source.id,
    sourceRevision: commitSha,
    updatedAt: fixtureNow,
  };
}

function createPreparationFixture(
  status: ServerPreparation["status"],
): ServerPreparation {
  const finished = status === "succeeded" || status === "failed";
  const definitions: Array<
    Pick<ServerPreparation["steps"][number], "id" | "title">
  > = [
    { id: "connecting", title: "Connect securely" },
    { id: "inspecting", title: "Inspect server" },
    { id: "installing_prerequisites", title: "Install prerequisites" },
    { id: "installing_docker", title: "Install Docker Engine" },
    { id: "installing_caddy", title: "Install Caddy" },
    { id: "configuring_access", title: "Configure access" },
    { id: "verifying", title: "Verify server" },
  ];
  return {
    createdAt: fixtureNow,
    errorCode:
      status === "failed" ? "SERVER_PREPARATION_INSTALLING_DOCKER" : null,
    errorMessage:
      status === "failed"
        ? "Conflicting container packages are installed. Use a fresh Ubuntu server, or clean up the conflicting installation before trying again."
        : null,
    finishedAt: finished ? fixtureNow : null,
    id: randomUUID(),
    result:
      status === "succeeded"
        ? {
            caddyVersion: "v2.11.4",
            dockerVersion: "28.3.3",
            operatingSystem: "Ubuntu 24.04 LTS",
            pythonVersion: "Python 3.12.3",
          }
        : null,
    startedAt: status === "queued" ? null : fixtureNow,
    status,
    steps: definitions.map((step, index) => ({
      ...step,
      finishedAt: finished ? fixtureNow : null,
      message:
        status === "succeeded"
          ? `${step.title} complete`
          : index === 0
            ? "Waiting for the server coordinator"
            : null,
      startedAt: status === "queued" ? null : fixtureNow,
      status: status === "succeeded" ? "succeeded" : "waiting",
    })),
  };
}

function createBackupFixture(
  id: string,
  resource: FixtureResource,
  createdAt: string,
  sizeBytes: number,
): SourceBackup {
  const key = `${resource.manifestId}/${createdAt.replaceAll(":", "-")}.dump`;
  return {
    createdAt,
    deletedAt: null,
    errorCode: null,
    errorMessage: null,
    finishedAt: createdAt,
    id,
    request: { type: "backup" },
    requestedBy: user.id,
    resourceId: resource.id,
    resourceKind: resource.kind,
    resourceManifestId: resource.manifestId,
    resourceName: resource.name,
    result: {
      backupId: id,
      bucket: "towbar-fixture-backups",
      checksum: "sha256:" + "a".repeat(64),
      deletedBackupIds: [],
      encryption: "AES256",
      key,
      region: "ap-south-1",
      sizeBytes,
      verifiedAt: createdAt,
      warnings: [],
    },
    serverId: resource.serverId,
    sourceId: resource.sourceId,
    startedAt: createdAt,
    state: "succeeded",
    type: "backup",
    updatedAt: createdAt,
  };
}

function createDeploymentFixture(
  id: string,
  deployable: App | Resource,
  server: Server,
  state: DeploymentState,
  createdAt = fixtureNow,
  trigger: Deployment["trigger"] = "manual",
): Deployment {
  const terminal = terminalStates.has(state);
  const startedAt = state === "queued" ? null : createdAt;
  return {
    appId: deployable.id,
    commitSha,
    createdAt,
    deployableKind: deployable.kind,
    errorCode: state === "failed" ? "FIXTURE_FAILURE" : null,
    errorMessage:
      state === "failed" ? "Representative fixture deployment failure." : null,
    finishedAt:
      terminal && startedAt
        ? new Date(new Date(startedAt).getTime() + 92_000).toISOString()
        : null,
    id,
    kind: trigger === "rollback" ? "rollback" : "deploy",
    manifestDigest,
    serverId: server.id,
    sourceId: source.id,
    startedAt,
    state,
    trigger,
    updatedAt: createdAt,
  };
}

function getDeploymentSteps(deployment: Deployment): DeploymentStep[] {
  if (terminalStates.has(deployment.state)) {
    return [
      createStep(deployment, "queued", 0, "succeeded"),
      createStep(
        deployment,
        deployment.state,
        1,
        deployment.state === "failed"
          ? "failed"
          : deployment.state === "cancelled" || deployment.state === "skipped"
            ? "skipped"
            : "succeeded",
      ),
    ];
  }
  const currentIndex = Math.max(0, workflowStates.indexOf(deployment.state));
  return workflowStates
    .slice(0, currentIndex + 1)
    .map((state, index) =>
      createStep(
        deployment,
        state,
        index,
        index === currentIndex ? "running" : "succeeded",
      ),
    );
}

function createStep(
  deployment: Deployment,
  state: DeploymentState,
  index: number,
  status: DeploymentStep["status"],
): DeploymentStep {
  return {
    createdAt: deployment.createdAt,
    finishedAt: status === "running" ? null : deployment.updatedAt,
    id: `${deployment.id.slice(0, 24)}${String(index).padStart(12, "0")}`,
    message:
      status === "running"
        ? `Fixture deployment is currently ${state.replaceAll("_", " ")}`
        : null,
    sequence: index,
    startedAt: deployment.startedAt,
    state,
    status,
  };
}

function getDeploymentLogs(deployment: Deployment): DeploymentLog[] {
  return [
    {
      content: "Preparing deployment fixture\n",
      createdAt: deployment.createdAt,
      id: `${deployment.id.slice(0, 24)}900000000001`,
      sequence: 1,
      stream: "stdout",
    },
    {
      content:
        deployment.state === "queued"
          ? "Waiting for an available server slot\n"
          : `Deployment reached ${deployment.state.replaceAll("_", " ")}\n`,
      createdAt: deployment.updatedAt,
      id: `${deployment.id.slice(0, 24)}900000000002`,
      sequence: 2,
      stream: deployment.state === "failed" ? "stderr" : "stdout",
    },
  ];
}

function writeDeploymentEvents(
  response: ServerResponse,
  deployment: Deployment,
) {
  response.writeHead(200, {
    "cache-control": "no-cache",
    connection: "keep-alive",
    "content-type": "text/event-stream",
  });
  const event: DeploymentEvent = {
    deployment,
    logs: getDeploymentLogs(deployment),
    steps: getDeploymentSteps(deployment),
  };
  response.write(
    `id: 1\nevent: deployment\ndata: ${JSON.stringify(event)}\n\n`,
  );
  const keepAlive = setInterval(
    () => response.write(": keep-alive\n\n"),
    15_000,
  );
  response.on("close", () => clearInterval(keepAlive));
}

function setCorsHeaders(response: ServerResponse, origin?: string) {
  if (origin) response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader(
    "access-control-allow-headers",
    "content-type,idempotency-key,last-event-id",
  );
  response.setHeader(
    "access-control-allow-methods",
    "DELETE,GET,OPTIONS,PATCH,POST,PUT",
  );
}

function writeJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

function writeNotFound(response: ServerResponse) {
  writeJson(response, 404, { error: { message: "Not found" } });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  const port = 4420;
  createFixtureApiServer().listen(port, "127.0.0.1", () => {
    console.info(`Towbar fixture API ready at http://127.0.0.1:${port}`);
  });
}
