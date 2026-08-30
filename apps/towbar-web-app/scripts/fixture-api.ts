import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";

import type {
  App,
  AppSecretBinding,
  AppSecretUse,
  AppSecretsResponse,
  AutoDeployControlResponse,
  AwsCredentialMetadata,
  Deployment,
  DeploymentEvent,
  DeploymentLog,
  DeploymentPlan,
  DeploymentState,
  DeploymentStep,
  GitHubConnection,
  GitHubRepository,
  NotificationDestination,
  NotificationEvent,
  OrphanItem,
  PreviewEnvironment,
  PreviewReportingHealth,
  Release,
  Resource,
  ResourceOperation,
  RuntimeCapacity,
  Server,
  ServerCheck,
  ServerPreparation,
  Source,
  SourceBackup,
  SourceSync,
  SystemHealth,
  TowbarUser,
  TrustedHostKey,
  UserSession,
} from "@workspace/towbar-web-client";

export const fixtureIds = {
  app: "31111111-1111-4111-8111-222222222222",
  deployment: "61111111-1111-4111-8111-111111111111",
  deploymentPlan: "71111111-1111-4111-8111-111111111112",
  preview: "b1111111-1111-4111-8111-111111111111",
  previewDeployment: "61111111-1111-4111-8111-444444444444",
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
const systemHealthFixtureNow = new Date().toISOString();
const commitSha = "c".repeat(40);
const manifestDigest = "d".repeat(64);
const sharedBuildSecret = "aws:fixture/shared/build";
const sharedDeploymentSecret = "aws:fixture/shared/deployment";
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

const baseAutoDeployControl: AutoDeployControlResponse["autoDeploy"]["control"] =
  {
    failureThreshold: 3,
    maintenanceWindow: null,
    paused: false,
    pausedAt: null,
    pausedBy: null,
    pauseReason: null,
    recoveryPolicy: "manual",
    updatedAt: null,
    updatedBy: null,
  };

const sourceAutoDeployControl = createAutoDeployControlFixture("source");
const deployableAutoDeployControls = new Map<
  string,
  AutoDeployControlResponse["autoDeploy"]
>();

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

const fixtureSecretKeys = new Map<string, string[]>([
  [sharedBuildSecret, ["BUILD_CACHE_TOKEN", "PACKAGE_REGISTRY_TOKEN"]],
  [sharedDeploymentSecret, ["SENTRY_DSN"]],
  ...apps.flatMap((app) => [
    [app.config.secrets.build!, ["NPM_TOKEN"]] as [string, string[]],
    [app.config.secrets.deployment!, ["DATABASE_URL", "SESSION_SECRET"]] as [
      string,
      string[],
    ],
    ...(app.config.preview?.secrets.build
      ? [
          [app.config.preview.secrets.build, ["PREVIEW_NPM_TOKEN"]] as [
            string,
            string[],
          ],
        ]
      : []),
    ...(app.config.preview?.secrets.deployment
      ? [
          [
            app.config.preview.secrets.deployment,
            ["PREVIEW_DATABASE_URL", "PREVIEW_SESSION_SECRET"],
          ] as [string, string[]],
        ]
      : []),
  ]),
  ...resources.flatMap((resource) =>
    resource.config.secrets.deployment
      ? [
          [
            resource.config.secrets.deployment,
            resource.kind === "postgres"
              ? ["POSTGRES_PASSWORD"]
              : resource.kind === "redis"
                ? ["REDIS_PASSWORD"]
                : ["SERVICE_TOKEN"],
          ] as [string, string[]],
        ]
      : [],
  ),
]);
const fixtureSecretVersions = new Map(
  [...fixtureSecretKeys.keys()].map((reference) => [
    reference,
    crypto.randomUUID(),
  ]),
);
const fixtureSecretValues = new Map(
  [...fixtureSecretKeys.entries()].map(([reference, keys]) => [
    reference,
    Object.fromEntries(
      keys.map((key) => [key, `fixture-${key.toLowerCase()}`]),
    ),
  ]),
);

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

const previewDeployment: Deployment = {
  ...createDeploymentFixture(
    fixtureIds.previewDeployment,
    apps[1]!,
    servers[1]!,
    "succeeded",
    fixtureNow,
    "auto_deploy",
  ),
  environment: "preview",
  gitRef: "refs/pull/42/head",
  githubDeploymentId: "123456789",
  hostname:
    "example-website-feature-preview-fixture-a1b2c3d4.preview.example.com",
};
deployments.push(previewDeployment);

const previews: PreviewEnvironment[] = [
  {
    appId: apps[1]!.id,
    appName: apps[1]!.name,
    branch: "feature/preview-fixture",
    cleanupAttempts: 0,
    createdAt: fixtureNow,
    errorMessage: null,
    expiresAt: "2026-08-25T09:00:00.000Z",
    gitRef: "refs/heads/feature/preview-fixture",
    hostname: previewDeployment.hostname!,
    id: fixtureIds.preview,
    latestCommitSha: commitSha,
    latestDeploymentId: previewDeployment.id,
    nextCleanupAttemptAt: null,
    pullRequestNumber: 42,
    pullRequestUrl: "https://github.com/avgeek-inc/towbar/pull/42",
    sourceId: source.id,
    status: "healthy",
    updatedAt: fixtureNow,
  },
  {
    appId: apps[1]!.id,
    appName: apps[1]!.name,
    branch: "fix/preview-cleanup",
    cleanupAttempts: 2,
    createdAt: fixtureNow,
    errorMessage: "The server could not be reached over SSH",
    expiresAt: "2026-08-25T09:00:00.000Z",
    gitRef: "refs/heads/fix/preview-cleanup",
    hostname: "example-website-pr-43.preview.example.com",
    id: "b1111111-1111-4111-8111-222222222222",
    latestCommitSha: "e".repeat(40),
    latestDeploymentId: null,
    nextCleanupAttemptAt: "2026-08-28T04:15:00.000Z",
    pullRequestNumber: 43,
    pullRequestUrl: "https://github.com/avgeek-inc/towbar/pull/43",
    sourceId: source.id,
    status: "cleanup_failed",
    updatedAt: fixtureNow,
  },
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

const deploymentPlans: DeploymentPlan[] = [
  {
    branch: "feature/deployment-plan-fixture",
    createdAt: fixtureNow,
    currentCommitSha: commitSha,
    currentManifestDigest: manifestDigest,
    githubCheckError: null,
    githubCheckRunId: "1234567890",
    githubCheckStatus: "published",
    id: fixtureIds.deploymentPlan,
    plan: {
      checks: [
        {
          code: "manifest_schema",
          message: "The candidate deployment manifest is valid.",
          status: "passed",
        },
        {
          code: "server_capacity",
          entityId: fixtureIds.server,
          entityKind: "server",
          message:
            "192.0.2.10 has limited Docker disk capacity. Review the server before deployment.",
          references: ["192.0.2.10"],
          status: "warning",
        },
      ],
      items: [
        {
          action: "update",
          automaticDeployment: true,
          changedFields: ["dockerfile", "health.path"],
          entityId: apps[1]!.manifestId,
          entityKind: "app",
          matchedPaths: ["apps/example-website/src/page.tsx"],
          name: apps[1]!.name,
          reasons: ["Deployment inputs changed in this pull request"],
        },
        {
          action: "no_op",
          automaticDeployment: false,
          changedFields: [],
          entityId: resources[0]!.manifestId,
          entityKind: "resource",
          matchedPaths: [],
          name: resources[0]!.name,
          reasons: ["No material configuration change"],
        },
      ],
      status: "ready",
      summary: { archive: 0, create: 0, no_op: 1, restore: 0, update: 1 },
    },
    pullRequestNumber: 42,
    sourceId: source.id,
    status: "ready",
    targetCommitSha: "e".repeat(40),
    targetManifestDigest: "f".repeat(64),
    trigger: "pull_request",
  },
];

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
  permissionReadiness: {
    checks: "write",
    contents: "read",
    deployments: "write",
    planning: "ready",
    preview: "ready",
    pullRequests: "write",
    status: "available",
  },
  suspendedAt: null,
  updatedAt: fixtureNow,
};

const previewReporting: PreviewReportingHealth = {
  failedCount: 1,
  lastError: "GitHub temporarily rejected the Preview status update",
  lastFailedAt: fixtureNow,
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

let systemHealth: SystemHealth = {
  checkedAt: systemHealthFixtureNow,
  checks: [
    {
      checkedAt: systemHealthFixtureNow,
      description:
        "The API is responding and the current database schema is queryable.",
      id: "api-database",
      remediationHref: null,
      remediationLabel: null,
      status: "healthy",
      title: "API and database",
    },
    {
      checkedAt: systemHealthFixtureNow,
      description:
        "Temporal accepted a signal for the durable maintenance workflow.",
      id: "temporal",
      remediationHref: null,
      remediationLabel: null,
      status: "healthy",
      title: "Temporal",
    },
    {
      checkedAt: systemHealthFixtureNow,
      description:
        "The worker completed a scheduled maintenance sweep through Temporal.",
      id: "worker",
      remediationHref: null,
      remediationLabel: null,
      status: "healthy",
      title: "Worker and maintenance",
    },
    {
      checkedAt: systemHealthFixtureNow,
      description: "GitHub confirmed access to example-inc.",
      id: "github",
      remediationHref: null,
      remediationLabel: null,
      status: "healthy",
      title: "GitHub App",
    },
  ],
  status: "healthy",
  version: "1.0.2-fixture",
};

const runtimeCapacity: RuntimeCapacity[] = [
  {
    checkedAt: systemHealthFixtureNow,
    cpu: { loadAverage1m: 1.7, logicalCount: 4, usagePercent: 38.4 },
    disk: {
      availableBytes: 12_884_901_888,
      totalBytes: 107_374_182_400,
      usedPercent: 88,
    },
    id: fixtureIds.server,
    ip: servers[0]!.canonicalIp,
    latestCheckStatus: "succeeded",
    memory: {
      availableBytes: 5_583_457_280,
      totalBytes: 17_179_869_184,
      usedPercent: 67.5,
    },
    runtimes: [
      {
        cpuPercent: 4.7,
        healthStatus: "healthy",
        id: apps[0]!.id,
        kind: "app",
        memoryLimitBytes: 4_294_967_296,
        memoryUsageBytes: 734_003_200,
        name: apps[0]!.name,
        observedState: "running",
        restartCount: 2,
        startedAt: "2026-08-21T09:00:00.000Z",
      },
      {
        cpuPercent: 1.2,
        healthStatus: "healthy",
        id: resources[0]!.id,
        kind: "postgres",
        memoryLimitBytes: 4_294_967_296,
        memoryUsageBytes: 1_342_177_280,
        name: resources[0]!.name,
        observedState: "running",
        restartCount: 0,
        startedAt: "2026-08-20T09:00:00.000Z",
      },
    ],
    sourceId: source.id,
    status: "attention",
    uptimeSeconds: 1_236_420,
  },
  {
    checkedAt: systemHealthFixtureNow,
    cpu: { loadAverage1m: 0.8, logicalCount: 8, usagePercent: 22.6 },
    disk: {
      availableBytes: 73_014_444_032,
      totalBytes: 107_374_182_400,
      usedPercent: 32,
    },
    id: fixtureIds.secondaryServer,
    ip: servers[1]!.canonicalIp,
    latestCheckStatus: "succeeded",
    memory: {
      availableBytes: 22_548_578_304,
      totalBytes: 34_359_738_368,
      usedPercent: 34.4,
    },
    runtimes: [
      ...apps.slice(1).map((app, index) => ({
        cpuPercent: 1.4 + index,
        healthStatus: "healthy" as const,
        id: app.id,
        kind: "app" as const,
        memoryLimitBytes: 4_294_967_296,
        memoryUsageBytes: 314_572_800 + index * 52_428_800,
        name: app.name,
        observedState: "running" as const,
        restartCount: 0,
        startedAt: "2026-08-22T07:00:00.000Z",
      })),
      ...resources.slice(1).map((resource, index) => ({
        cpuPercent: 0.8 + index,
        healthStatus: "healthy" as const,
        id: resource.id,
        kind: resource.kind,
        memoryLimitBytes: 4_294_967_296,
        memoryUsageBytes: 262_144_000 + index * 78_643_200,
        name: resource.name,
        observedState: "running" as const,
        restartCount: 0,
        startedAt: "2026-08-22T07:00:00.000Z",
      })),
    ],
    sourceId: source.id,
    status: "healthy",
    uptimeSeconds: 923_580,
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
const notificationDestinations: NotificationDestination[] = [
  {
    categories: ["deployments", "previews", "health"],
    config: { channelId: "C0123456789" },
    createdAt: fixtureNow,
    enabled: true,
    id: "a1111111-1111-4111-8111-111111111111",
    provider: "slack",
    sourceId: source.id,
    updatedAt: fixtureNow,
  },
  {
    categories: ["backups", "restores"],
    config: {
      recipients: ["operations@example.com"],
    },
    createdAt: fixtureNow,
    enabled: false,
    id: "a1111111-1111-4111-8111-222222222222",
    provider: "smtp",
    sourceId: source.id,
    updatedAt: fixtureNow,
  },
];
const notificationEvents: NotificationEvent[] = [
  createNotificationEventFixture(
    "b1111111-1111-4111-8111-111111111111",
    "deployment.failed",
  ),
  createNotificationEventFixture(
    "b1111111-1111-4111-8111-222222222222",
    "preview.ready",
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
    if (
      request.method === "POST" &&
      path === "/v1/core/system-health/actions/check"
    ) {
      const checkedAt = new Date().toISOString();
      systemHealth = {
        ...systemHealth,
        checkedAt,
        checks: systemHealth.checks.map((check) => ({
          ...check,
          checkedAt,
          status: "healthy",
        })),
        status: "healthy",
      };
      return writeJson(response, 200, systemHealth);
    }
    if (request.method === "POST" && path === "/v1/core/sources") {
      return writeJson(response, 201, { source });
    }
    if (
      request.method === "POST" &&
      path === `/v1/core/sources/${source.id}/actions/sync`
    ) {
      return writeJson(response, 202, { sync: { id: sourceSync.id } });
    }
    const autoDeployControlMatch = path.match(
      /^\/v1\/core\/(sources|apps|resources)\/([^/]+)\/auto-deploy-control$/,
    );
    if (autoDeployControlMatch) {
      const [, kind, id] = autoDeployControlMatch;
      const control =
        kind === "sources"
          ? id === source.id
            ? sourceAutoDeployControl
            : undefined
          : getFixtureDeployableAutoDeployControl(kind!, id!);
      if (!control) return writeNotFound(response);
      if (request.method === "GET") {
        return writeJson(response, 200, {
          autoDeploy: control,
          canManageAutoDeploy: true,
        });
      }
      if (request.method === "PATCH") {
        void readRequestJson(request)
          .then((input) => {
            applyFixtureAutoDeployControlPatch(
              control,
              input as Record<string, unknown>,
            );
            return writeJson(response, 200, {
              autoDeploy: control,
              canManageAutoDeploy: true,
            });
          })
          .catch(() =>
            writeJson(response, 400, {
              error: { message: "Request body must be valid JSON" },
            }),
          );
        return;
      }
    }
    const notificationDestinationMatch = path.match(
      new RegExp(
        `^/v1/core/sources/${source.id}/notifications/destinations(?:/([^/]+)(?:/actions/test)?)?$`,
      ),
    );
    if (notificationDestinationMatch && request.method === "POST") {
      const destinationId = notificationDestinationMatch[1];
      if (destinationId && path.endsWith("/actions/test")) {
        const destination = notificationDestinations.find(
          (item) => item.id === destinationId,
        );
        if (!destination) return writeNotFound(response);
        notificationEvents.unshift(
          createNotificationEventFixture(randomUUID(), "notification.test"),
        );
        return writeJson(response, 202, {
          delivery: { cycle: 1, id: randomUUID() },
        });
      }
      void readRequestJson(request)
        .then((input) => {
          const now = new Date().toISOString();
          const destination = {
            ...(input as Omit<
              NotificationDestination,
              "createdAt" | "id" | "sourceId" | "updatedAt"
            >),
            createdAt: now,
            id: randomUUID(),
            sourceId: source.id,
            updatedAt: now,
          } satisfies NotificationDestination;
          notificationDestinations.push(destination);
          return writeJson(response, 201, { destination });
        })
        .catch(() => writeJson(response, 400, { error: "Invalid JSON" }));
      return;
    }
    if (notificationDestinationMatch && request.method === "PUT") {
      const destination = notificationDestinations.find(
        (item) => item.id === notificationDestinationMatch[1],
      );
      if (!destination) return writeNotFound(response);
      void readRequestJson(request)
        .then((input) => {
          Object.assign(destination, input, {
            updatedAt: new Date().toISOString(),
          });
          return writeJson(response, 200, { destination });
        })
        .catch(() => writeJson(response, 400, { error: "Invalid JSON" }));
      return;
    }
    if (notificationDestinationMatch && request.method === "DELETE") {
      const index = notificationDestinations.findIndex(
        (item) => item.id === notificationDestinationMatch[1],
      );
      if (index < 0) return writeNotFound(response);
      notificationDestinations.splice(index, 1);
      response.writeHead(204);
      response.end();
      return;
    }
    if (
      request.method === "PATCH" &&
      path === `/v1/core/sources/${source.id}/secrets`
    ) {
      void readRequestJson(request)
        .then((input) => {
          const payload = input as {
            delete?: string[];
            expectedVersionId?: string;
            reference?: string;
            set?: Record<string, string>;
          };
          const binding = getFixtureSourceSecrets().bindings.find(
            (candidate) => candidate.reference === payload.reference,
          );
          const currentVersion = payload.reference
            ? fixtureSecretVersions.get(payload.reference)
            : undefined;
          if (!payload.reference || !binding || !currentVersion) {
            return writeNotFound(response);
          }
          if (payload.expectedVersionId !== currentVersion) {
            return writeJson(response, 409, {
              error: { message: "This secret changed after it was loaded." },
            });
          }
          applyFixtureSecretMutation(payload.reference, payload);
          return writeJson(response, 200, {
            secret: getFixtureSourceSecrets().bindings.find(
              (candidate) => candidate.reference === payload.reference,
            ),
          });
        })
        .catch(() =>
          writeJson(response, 400, {
            error: { message: "Request body must be valid JSON" },
          }),
        );
      return;
    }
    if (
      request.method === "POST" &&
      path === `/v1/core/sources/${source.id}/secrets/reveal`
    ) {
      void readRequestJson(request)
        .then((input) => {
          const reference = (input as { reference?: string }).reference;
          const binding = getFixtureSourceSecrets().bindings.find(
            (candidate) => candidate.reference === reference,
          );
          if (!reference || !binding) return writeNotFound(response);
          return writeFixtureSecretReveal(response, reference);
        })
        .catch(() => writeJson(response, 400, { error: "Invalid JSON" }));
      return;
    }
    const secretMutationMatch = path.match(
      /^\/v1\/core\/(apps|resources)\/([^/]+)\/secrets$/,
    );
    if (request.method === "PATCH" && secretMutationMatch) {
      const deployable =
        secretMutationMatch[1] === "apps"
          ? apps.find((item) => item.id === secretMutationMatch[2])
          : resources.find((item) => item.id === secretMutationMatch[2]);
      if (!deployable) return writeNotFound(response);
      void readRequestJson(request)
        .then((input) => {
          const payload = input as {
            delete?: string[];
            expectedVersionId?: string;
            reference?: string;
            set?: Record<string, string>;
          };
          const currentVersion = payload.reference
            ? fixtureSecretVersions.get(payload.reference)
            : undefined;
          const binding = getFixtureDeployableSecrets(deployable).bindings.find(
            (candidate) => candidate.reference === payload.reference,
          );
          if (!payload.reference || !currentVersion || !binding) {
            return writeNotFound(response);
          }
          if (payload.expectedVersionId !== currentVersion) {
            return writeJson(response, 409, {
              error: { message: "This secret changed after it was loaded." },
            });
          }
          applyFixtureSecretMutation(payload.reference, payload);
          const secret = getFixtureDeployableSecrets(deployable).bindings.find(
            (candidate) => candidate.reference === payload.reference,
          );
          return writeJson(response, 200, { secret });
        })
        .catch(() =>
          writeJson(response, 400, {
            error: { message: "Request body must be valid JSON" },
          }),
        );
      return;
    }
    const secretRevealMatch = path.match(
      /^\/v1\/core\/(apps|resources)\/([^/]+)\/secrets\/reveal$/,
    );
    if (request.method === "POST" && secretRevealMatch) {
      const deployable =
        secretRevealMatch[1] === "apps"
          ? apps.find((item) => item.id === secretRevealMatch[2])
          : resources.find((item) => item.id === secretRevealMatch[2]);
      if (!deployable) return writeNotFound(response);
      void readRequestJson(request)
        .then((input) => {
          const reference = (input as { reference?: string }).reference;
          const binding = getFixtureDeployableSecrets(deployable).bindings.find(
            (candidate) => candidate.reference === reference,
          );
          if (!reference || !binding) return writeNotFound(response);
          return writeFixtureSecretReveal(response, reference);
        })
        .catch(() => writeJson(response, 400, { error: "Invalid JSON" }));
      return;
    }
    const deletePreviewMatch = path.match(
      /^\/v1\/core\/previews\/([^/]+)\/actions\/delete$/,
    );
    if (request.method === "POST" && deletePreviewMatch) {
      const preview = previews.find(
        (item) => item.id === deletePreviewMatch[1],
      );
      if (!preview) return writeNotFound(response);
      preview.status = "deleting";
      preview.updatedAt = new Date().toISOString();
      return writeJson(response, 202, { accepted: true });
    }
    if (
      request.method === "POST" &&
      path === "/v1/core/github/actions/retry-preview-reporting"
    ) {
      previewReporting.failedCount = 0;
      previewReporting.lastError = null;
      previewReporting.lastFailedAt = null;
      return writeJson(response, 200, {
        attempted: 1,
        failed: 0,
        succeeded: 1,
      });
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
    const revokeHostKeyMatch = path.match(
      /^\/v1\/core\/servers\/([^/]+)\/host-keys\/([^/]+)$/,
    );
    if (request.method === "DELETE" && revokeHostKeyMatch) {
      const hostKeys = hostKeysByServer.get(revokeHostKeyMatch[1]!);
      const index = hostKeys?.findIndex(
        (key) => key.id === revokeHostKeyMatch[2],
      );
      if (!hostKeys || index === undefined || index < 0) {
        return writeNotFound(response);
      }
      hostKeys.splice(index, 1);
      response.writeHead(204);
      response.end();
      return;
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
    const deployActionMatch = path.match(
      /^\/v1\/core\/(apps|resources)\/([^/]+)\/actions\/deploy$/,
    );
    if (request.method === "POST" && deployActionMatch) {
      const deployable =
        deployActionMatch[1] === "apps"
          ? apps.find((item) => item.id === deployActionMatch[2])
          : resources.find((item) => item.id === deployActionMatch[2]);
      if (!deployable) return writeNotFound(response);
      const server = servers.find((item) => item.id === deployable.serverId);
      if (!server) return writeNotFound(response);
      const deployment = createDeploymentFixture(
        randomUUID(),
        deployable,
        server,
        "queued",
        new Date().toISOString(),
      );
      deployments.unshift(deployment);
      return writeJson(response, 202, { deployment });
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
    [
      "/v1/core/github",
      {
        connection: githubConnection,
        previewReporting,
      },
    ],
    ["/v1/core/github/repositories", { repositories: githubRepositories }],
    ["/v1/core/sources", { sources: [source] }],
    ["/v1/core/apps", { apps }],
    ["/v1/core/resources", { resources }],
    ["/v1/core/servers", { servers }],
    ["/v1/core/system-health", systemHealth],
    [
      "/v1/core/deployments",
      {
        deployments: deployments.filter(
          (deployment) => deployment.environment === "production",
        ),
      },
    ],
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
    [`/v1/core/sources/${source.id}/capacity`, { capacities: runtimeCapacity }],
    [`/v1/core/sources/${source.id}/previews`, { previews }],
    [`/v1/core/sources/${source.id}/plans`, { plans: deploymentPlans }],
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
    [
      `/v1/core/sources/${source.id}/deployments`,
      {
        deployments: deployments.filter(
          (deployment) => deployment.environment === "production",
        ),
      },
    ],
    [`/v1/core/sources/${source.id}/backups`, { backups: sourceBackups }],
    [
      `/v1/core/sources/${source.id}/notifications/destinations`,
      {
        canManageNotifications: true,
        destinations: notificationDestinations,
        providers: { slack: true, smtp: true },
      },
    ],
    [`/v1/core/notifications`, { notifications: notificationEvents }],
    [
      `/v1/core/sources/${source.id}/syncs/${sourceSync.id}`,
      { sync: sourceSync },
    ],
  ]);
  const fixed = fixedPayloads.get(path);
  if (fixed !== undefined) return fixed;

  const deploymentPlanMatch = path.match(
    new RegExp(`^/v1/core/sources/${source.id}/plans/([^/]+)$`),
  );
  if (deploymentPlanMatch) {
    const plan = deploymentPlans.find(
      (item) => item.id === deploymentPlanMatch[1],
    );
    return plan ? { plan } : undefined;
  }

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

  if (path === `/v1/core/sources/${source.id}/secrets`) {
    return getFixtureSourceSecrets();
  }

  const deployableSecretsMatch = path.match(
    /^\/v1\/core\/(apps|resources)\/([^/]+)\/secrets$/,
  );
  if (deployableSecretsMatch) {
    const deployable =
      deployableSecretsMatch[1] === "apps"
        ? apps.find((item) => item.id === deployableSecretsMatch[2])
        : resources.find((item) => item.id === deployableSecretsMatch[2]);
    return deployable ? getFixtureDeployableSecrets(deployable) : undefined;
  }

  const deployableMatch = path.match(
    /^\/v1\/core\/(apps|resources)\/([^/]+)(?:\/(deployments|releases|operations|previews))?$/,
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
        deployments: deployments.filter(
          (item) => item.appId === id && item.environment === "production",
        ),
      };
    }
    if (child === "previews") {
      return { previews: previews.filter((item) => item.appId === id) };
    }
    if (child === "releases") {
      return { releases: releases.filter((item) => item.appId === id) };
    }
    if (child === "operations") return { operations: runtimeOperations };
    return kind === "apps" ? { app: deployable } : { resource: deployable };
  }

  const serverMatch = path.match(
    /^\/v1\/core\/servers\/([^/]+)(?:\/(apps|resources|deployments|capacity|checks|host-keys|orphans|preparations))?$/,
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
    if (child === "capacity") {
      return {
        capacity: runtimeCapacity.find((item) => item.id === server.id),
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

function createAutoDeployControlFixture(
  targetType: "app" | "resource" | "source",
): AutoDeployControlResponse["autoDeploy"] {
  return {
    ...(targetType === "source"
      ? {}
      : {
          circuit: {
            consecutiveFailures: 0,
            failureFingerprint: null,
            openedAt: null,
            openedReason: null,
          },
          manifestAutoDeployEnabled: true,
        }),
    control: { ...baseAutoDeployControl },
    effective: {
      actor: null,
      blocked: false,
      nextOpenAt: null,
      pending: null,
      reason: null,
      reasonDetail: null,
      scope: null,
    },
    recentEvents: [],
  };
}

function getFixtureDeployableAutoDeployControl(kind: string, id: string) {
  const deployable =
    kind === "apps"
      ? apps.find((item) => item.id === id)
      : resources.find((item) => item.id === id);
  if (!deployable) return undefined;
  let control = deployableAutoDeployControls.get(id);
  if (!control) {
    control = createAutoDeployControlFixture(
      kind === "apps" ? "app" : "resource",
    );
    deployableAutoDeployControls.set(id, control);
  }
  return control;
}

function applyFixtureAutoDeployControlPatch(
  target: AutoDeployControlResponse["autoDeploy"],
  patch: Record<string, unknown>,
) {
  const now = new Date().toISOString();
  if (typeof patch.paused === "boolean") {
    target.control.paused = patch.paused;
    target.control.pausedAt = patch.paused ? now : null;
    target.control.pausedBy = patch.paused ? user.id : null;
    target.control.pauseReason = patch.paused
      ? typeof patch.pauseReason === "string"
        ? patch.pauseReason
        : "Paused by operator"
      : null;
  }
  if ("maintenanceWindow" in patch) {
    target.control.maintenanceWindow =
      patch.maintenanceWindow as AutoDeployControlResponse["autoDeploy"]["control"]["maintenanceWindow"];
  }
  if (typeof patch.failureThreshold === "number") {
    target.control.failureThreshold = patch.failureThreshold;
  }
  if (
    patch.recoveryPolicy === "manual" ||
    patch.recoveryPolicy === "on_manual_success"
  ) {
    target.control.recoveryPolicy = patch.recoveryPolicy;
  }
  if (patch.recoverCircuit && target.circuit) {
    target.circuit = {
      consecutiveFailures: 0,
      failureFingerprint: null,
      openedAt: null,
      openedReason: null,
    };
  }
  target.control.updatedAt = now;
  target.control.updatedBy = user.id;
  target.effective = fixtureAutoDeployEffectiveState(target);
  target.recentEvents.unshift({
    action: patch.recoverCircuit
      ? "auto_deploy.circuit_recovered"
      : "auto_deploy.control_updated",
    actor: { displayName: user.name, id: user.id },
    createdAt: now,
    id: randomUUID(),
    metadata: { paused: target.control.paused },
    targetId: null,
    targetType: target.circuit ? "app" : "source",
  });
}

function fixtureAutoDeployEffectiveState(
  target: AutoDeployControlResponse["autoDeploy"],
): AutoDeployControlResponse["autoDeploy"]["effective"] {
  const scope = target.circuit ? "deployable" : "source";
  if (target.control.paused) {
    return {
      actor: { displayName: user.name, id: user.id },
      blocked: true,
      nextOpenAt: null,
      pending: target.effective.pending,
      reason: "paused",
      reasonDetail: target.control.pauseReason,
      scope,
    };
  }
  const window = target.control.maintenanceWindow;
  if (window && !fixtureMaintenanceWindowOpen(window)) {
    return {
      actor: { displayName: user.name, id: user.id },
      blocked: true,
      nextOpenAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      pending: target.effective.pending,
      reason: "maintenance_window",
      reasonDetail: "Outside the configured maintenance window",
      scope,
    };
  }
  if (target.circuit?.openedAt) {
    return {
      actor: null,
      blocked: true,
      nextOpenAt: null,
      pending: target.effective.pending,
      reason: "circuit_open",
      reasonDetail: "Comparable deployment failures opened the circuit",
      scope: "deployable",
    };
  }
  return {
    actor: null,
    blocked: false,
    nextOpenAt: null,
    pending: null,
    reason: null,
    reasonDetail: null,
    scope: null,
  };
}

function fixtureMaintenanceWindowOpen(
  window: NonNullable<
    AutoDeployControlResponse["autoDeploy"]["control"]["maintenanceWindow"]
  >,
) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      minute: "numeric",
      timeZone: window.timezone,
      weekday: "short",
    })
      .formatToParts(new Date())
      .map((part) => [part.type, part.value]),
  );
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    values.weekday ?? "",
  );
  const minute = Number(values.hour) * 60 + Number(values.minute);
  const crossesMidnight = window.endMinute <= window.startMinute;
  return crossesMidnight
    ? (window.daysOfWeek.includes(day) && minute >= window.startMinute) ||
        (window.daysOfWeek.includes((day + 6) % 7) && minute < window.endMinute)
    : window.daysOfWeek.includes(day) &&
        minute >= window.startMinute &&
        minute < window.endMinute;
}

function readPositiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getFixtureDeployableSecrets(
  deployable: FixtureApp | FixtureResource,
): AppSecretsResponse {
  return getFixtureSecretsResponse(
    getFixtureSecretUses(deployable).filter((use) => use.scope === "app"),
  );
}

function getFixtureSourceSecrets(): AppSecretsResponse {
  return getFixtureSecretsResponse(
    [...apps, ...resources]
      .flatMap((deployable) => getFixtureSecretUses(deployable))
      .filter((use) => use.scope === "shared"),
  );
}

function getFixtureSecretsResponse(
  uses: Array<AppSecretUse & { reference: string }>,
): AppSecretsResponse {
  const references = [...new Set(uses.map((use) => use.reference))].sort();
  return {
    bindings: references.map((reference) => ({
      affectedDeployables: [...apps, ...resources]
        .flatMap((deployable) => {
          const affectedUses = getFixtureSecretUses(deployable).filter(
            (use) => use.reference === reference,
          );
          if (affectedUses.length === 0) return [];
          return [
            {
              id: deployable.id,
              kind:
                deployable.kind === "app"
                  ? ("app" as const)
                  : ("resource" as const),
              manifestId: deployable.manifestId,
              name: deployable.name,
              uses: affectedUses.map(({ reference: _, ...use }) => use),
            },
          ];
        })
        .sort((left, right) => left.name.localeCompare(right.name)),
      changedAt: fixtureNow,
      editable: true,
      errorMessage: null,
      keys: fixtureSecretKeys.get(reference) ?? [],
      provider: "aws",
      providerReference: reference.slice("aws:".length),
      reference,
      status: "available",
      uses: uses
        .filter((use) => use.reference === reference)
        .map(({ reference: _, ...use }) => use),
      versionId: fixtureSecretVersions.get(reference) ?? null,
    })) satisfies AppSecretBinding[],
    canManageSecrets: true,
  };
}

function applyFixtureSecretMutation(
  reference: string,
  payload: { delete?: string[]; set?: Record<string, string> },
) {
  const keys = new Set(fixtureSecretKeys.get(reference) ?? []);
  const values = { ...(fixtureSecretValues.get(reference) ?? {}) };
  for (const key of payload.delete ?? []) {
    keys.delete(key);
    delete values[key];
  }
  for (const [key, value] of Object.entries(payload.set ?? {})) {
    keys.add(key);
    values[key] = value;
  }
  fixtureSecretKeys.set(reference, [...keys].sort());
  fixtureSecretValues.set(reference, values);
  fixtureSecretVersions.set(reference, crypto.randomUUID());
}

function writeFixtureSecretReveal(response: ServerResponse, reference: string) {
  response.setHeader("cache-control", "no-store, max-age=0");
  response.setHeader("pragma", "no-cache");
  return writeJson(response, 200, {
    secret: {
      changedAt: fixtureNow,
      values: fixtureSecretValues.get(reference) ?? {},
      versionId: fixtureSecretVersions.get(reference),
    },
  });
}

function getFixtureSecretUses(deployable: FixtureApp | FixtureResource) {
  const uses: Array<AppSecretUse & { reference: string }> = [];
  if (deployable.kind === "app") {
    for (const reference of deployable.config.sharedSecrets?.build ?? []) {
      uses.push({ reference, scope: "shared", stage: "build" });
    }
    if (deployable.config.secrets.build) {
      uses.push({
        reference: deployable.config.secrets.build,
        scope: "app",
        stage: "build",
      });
    }
    if (deployable.config.preview?.secrets.build) {
      uses.push({
        reference: deployable.config.preview.secrets.build,
        scope: "app",
        stage: "preview_build",
      });
    }
    if (deployable.config.preview?.secrets.deployment) {
      uses.push({
        reference: deployable.config.preview.secrets.deployment,
        scope: "app",
        stage: "preview_deployment",
      });
    }
  }
  for (const reference of deployable.config.sharedSecrets?.deployment ?? []) {
    uses.push({ reference, scope: "shared", stage: "deployment" });
  }
  if (deployable.config.secrets.deployment) {
    uses.push({
      reference: deployable.config.secrets.deployment,
      scope: "app",
      stage: "deployment",
    });
  }
  return uses;
}

async function readRequestJson(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
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
      previewBuildConcurrency: 1,
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
      secrets: {
        build: `aws:fixture/apps/${manifestId}/build`,
        deployment: `aws:fixture/apps/${manifestId}/deployment`,
      },
      ...(id === fixtureIds.app
        ? {
            preview: {
              domain: "preview.example.com",
              enabled: true as const,
              secrets: {
                build: `aws:fixture/apps/${manifestId}/preview-build`,
                deployment: `aws:fixture/apps/${manifestId}/preview-deployment`,
                hooks: {},
              },
              ttlHours: 72,
            },
          }
        : {}),
      server: server.canonicalIp,
      sharedSecrets: {
        build: [sharedBuildSecret],
        deployment: [sharedDeploymentSecret],
      },
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
      secrets: {
        deployment: `aws:fixture/resources/${manifestId}/deployment`,
      },
      server: server.canonicalIp,
      sharedSecrets: {
        build: [sharedBuildSecret],
        deployment: [sharedDeploymentSecret],
      },
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

function createNotificationEventFixture(
  id: string,
  eventType: string,
): NotificationEvent {
  const category =
    eventType === "notification.test"
      ? "test"
      : eventType.startsWith("preview.")
        ? "previews"
        : "deployments";
  const payload = {
    details: {},
    entity: {
      id: fixtureIds.deployment,
      kind: "deployment",
      name: "Example Website",
    },
    message:
      eventType === "preview.ready"
        ? "Example Website Preview is ready."
        : eventType === "notification.test"
          ? "Towbar successfully reached this notification destination."
          : "Example Website deployment failed its health check.",
    occurredAt: fixtureNow,
    source: { id: source.id, name: source.repositoryName },
    title:
      eventType === "preview.ready"
        ? "Preview ready"
        : eventType === "notification.test"
          ? "Test notification"
          : "Deployment failed",
  };
  return {
    category,
    createdAt: fixtureNow,
    id,
    occurredAt: fixtureNow,
    payload,
    type: eventType,
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
    environment: "production",
    errorCode: state === "failed" ? "FIXTURE_FAILURE" : null,
    errorMessage:
      state === "failed" ? "Representative fixture deployment failure." : null,
    finishedAt:
      terminal && startedAt
        ? new Date(new Date(startedAt).getTime() + 92_000).toISOString()
        : null,
    id,
    gitRef: null,
    githubDeploymentId: null,
    hostname: null,
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
