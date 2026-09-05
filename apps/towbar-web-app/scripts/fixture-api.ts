import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { pathToFileURL } from "node:url";

import type {
  App,
  BackupAssurance,
  AppSecretsResponse,
  AutoDeployControlResponse,
  AwsCredentialMetadata,
  Deployment,
  DeploymentEvent,
  DeploymentLog,
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
  ResourceOperationEvent,
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
  VulnerabilityFinding,
  VulnerabilityScan,
} from "@workspace/towbar-web-client";

export const fixtureIds = {
  app: "31111111-1111-4111-8111-222222222222",
  deployment: "61111111-1111-4111-8111-111111111111",
  preview: "b1111111-1111-4111-8111-111111111111",
  previewDeployment: "61111111-1111-4111-8111-444444444444",
  imageResource: "41111111-1111-4111-8111-444444444444",
  resource: "41111111-1111-4111-8111-111111111111",
  secondaryPostgres: "41111111-1111-4111-8111-333333333333",
  secondaryServer: "21111111-1111-4111-8111-222222222222",
  server: "21111111-1111-4111-8111-111111111111",
  source: "11111111-1111-4111-8111-111111111111",
  docsSource: "11111111-1111-4111-8111-222222222222",
  analyticsSource: "11111111-1111-4111-8111-333333333333",
  sandboxSource: "11111111-1111-4111-8111-444444444444",
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

const sources: Source[] = [
  source,
  {
    ...source,
    id: fixtureIds.docsSource,
    repositoryName: "documentation",
    branch: "production",
  },
  {
    ...source,
    id: fixtureIds.analyticsSource,
    repositoryName: "analytics",
    branch: "main",
  },
  {
    ...source,
    id: fixtureIds.sandboxSource,
    repositoryName: "sandbox",
    branch: "develop",
    latestCommitSha: null,
    latestManifestDigest: null,
  },
];

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

apps.push({
  ...createAppFixture(
    "31111111-1111-4111-8111-444444444444",
    "Documentation",
    "documentation",
    servers[1]!,
  ),
  sourceId: fixtureIds.docsSource,
});
resources.push({
  ...createResourceFixture(
    "41111111-1111-4111-8111-555555555555",
    "Reporting Postgres",
    "reporting-postgres",
    "postgres",
    servers[1]!,
  ),
  sourceId: fixtureIds.analyticsSource,
});

const fixtureSecretKeys = new Map<string, string[]>();
const fixtureSecretVersions = new Map<string, string>();
const fixtureSecretValues = new Map<string, Record<string, string>>();
for (const app of apps) {
  fixtureSecretKeys.set(`${app.id}:production:deployment`, [
    "DATABASE_URL",
    "SESSION_SECRET",
  ]);
  fixtureSecretVersions.set(
    `${app.id}:production:deployment`,
    crypto.randomUUID(),
  );
}
fixtureSecretKeys.set(`${source.id}:production:build`, [
  "PACKAGE_REGISTRY_TOKEN",
]);
fixtureSecretVersions.set(`${source.id}:production:build`, crypto.randomUUID());
fixtureSecretKeys.set(`${user.workspaceId}:production:build`, [
  "GLOBAL_PACKAGE_TOKEN",
]);
fixtureSecretVersions.set(
  `${user.workspaceId}:production:build`,
  crypto.randomUUID(),
);
fixtureSecretKeys.set(`${user.workspaceId}:preview:build`, [
  "GLOBAL_PREVIEW_TOKEN",
]);
fixtureSecretVersions.set(
  `${user.workspaceId}:preview:build`,
  crypto.randomUUID(),
);
fixtureSecretKeys.set(`${source.id}:preview:build`, ["SOURCE_PREVIEW_TOKEN"]);
fixtureSecretVersions.set(`${source.id}:preview:build`, crypto.randomUUID());

const platformApps = apps.filter((app) => app.sourceId === source.id);

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
    const deployable = platformApps[index % platformApps.length]!;
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

const vulnerabilityFindings: VulnerabilityFinding[] = [
  {
    advisoryId: "CVE-2026-12001",
    fixedVersion: "3.2.4-r1",
    id: "a1111111-1111-4111-8111-111111111111",
    installedVersion: "3.2.3-r0",
    packageName: "libxml2",
    severity: "high",
    target: "node:24-alpine (alpine 3.23.1)",
  },
  {
    advisoryId: "CVE-2026-12002",
    fixedVersion: "1.2.14-r0",
    id: "a1111111-1111-4111-8111-222222222222",
    installedVersion: "1.2.13-r0",
    packageName: "zlib",
    severity: "medium",
    target: "node:24-alpine (alpine 3.23.1)",
  },
];

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
    imageDigest: `sha256:${"e".repeat(64)}`,
    imagePlatform: "linux/arm64",
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
  reconciliation: { apps: 3, resources: 2 },
  startedAt: fixtureNow,
  status: "succeeded",
};

let awsCredential: AwsCredentialMetadata | null = null;

const githubConnection: GitHubConnection = {
  accountLogin: "example-inc",
  accountType: "Organization",
  id: "b1111111-1111-4111-8111-111111111111",
  installationId: "12345678",
  permissionReadiness: {
    contents: "read",
    deployments: "write",
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

function fixtureSystemHealth(): SystemHealth {
  return {
    ...systemHealth,
    checks: [
      ...systemHealth.checks,
      ...(awsCredential
        ? [
            {
              id: "aws" as const,
              title: "AWS",
              checkedAt: awsCredential.lastVerifiedAt,
              description: `AWS identity verified. Region: ${awsCredential.region}.`,
              status: "healthy" as const,
              remediationHref: null,
              remediationLabel: null,
            },
          ]
        : []),
    ],
  };
}

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
        sourceId: source.id,
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
        sourceId: source.id,
        startedAt: "2026-08-20T09:00:00.000Z",
      },
    ],
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
        sourceId: app.sourceId,
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
        sourceId: resource.sourceId,
        startedAt: "2026-08-22T07:00:00.000Z",
      })),
    ],
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
    cancelRequestedAt: null,
    createdAt: fixtureNow,
    deletedAt: null,
    errorCode: "RESOURCE_OPERATION_FAILED",
    errorMessage: "UnknownError",
    finishedAt: fixtureNow,
    id: "e1111111-1111-4111-8111-222222222222",
    phase: null,
    request: { type: "backup" },
    requestedBy: null,
    resourceId: fixtureIds.secondaryPostgres,
    result: null,
    serverId: fixtureIds.secondaryServer,
    sourceId: fixtureIds.source,
    startedAt: fixtureNow,
    state: "failed",
    type: "backup",
    updatedAt: fixtureNow,
  },
  {
    cancelRequestedAt: null,
    createdAt: fixtureNow,
    deletedAt: null,
    errorCode: null,
    errorMessage: null,
    finishedAt: fixtureNow,
    id: "e1111111-1111-4111-8111-111111111111",
    phase: null,
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
  createBackupFixture(
    "f1111111-1111-4111-8111-333333333333",
    resources[1]!,
    "2026-08-21T14:15:00.000Z",
    48_331_776,
  ),
];
const backupAssurances: BackupAssurance[] = sourceBackups.map((backup) => {
  const s3AccessDenied = backup.resourceId === fixtureIds.secondaryPostgres;
  return {
    backupOperationId: backup.id,
    checkedAt: fixtureNow,
    checks: [
      "freshness",
      "object_exists",
      "size",
      "checksum",
      "encryption",
      "engine",
      "format",
    ].map((name) => ({
      message:
        s3AccessDenied && name === "object_exists"
          ? "Workspace AWS credentials cannot access the S3 object"
          : `${name.replaceAll("_", " ")} verified`,
      name,
      passed: !(s3AccessDenied && name === "object_exists"),
    })),
    resourceId: backup.resourceId!,
    restoreReady: !s3AccessDenied,
    status: s3AccessDenied ? "not_restore_ready" : "restore_ready",
    updatedAt: fixtureNow,
  };
});
const operationEventsByOperation = new Map<string, ResourceOperationEvent[]>();
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
  awsCredential = null;
  const apiKeys: Array<{
    id: string;
    name: string;
    prefix: string;
    access: string;
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
  }> = [];
  return createServer((request, response) => {
    if (!authorizeFixtureCorsRequest(response, request.headers.origin)) return;
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const path = requestUrl.pathname;
    if (path === "/v1/core/settings/api-keys") {
      if (request.method === "POST") {
        void readRequestJson(request)
          .then((input) => {
            const values = input as {
              name: string;
              access: string;
              expiresAt: string | null;
            };
            const key = {
              ...values,
              id: randomUUID(),
              prefix: "twb_fixture",
              createdAt: new Date().toISOString(),
              lastUsedAt: null,
              revokedAt: null,
            };
            apiKeys.push(key);
            writeJson(response, 201, {
              key,
              token: "twb_fixture_only_not_a_real_credential",
            });
          })
          .catch(() => writeJson(response, 400, { error: "Invalid JSON" }));
      } else
        writeJson(response, 200, {
          keys: apiKeys,
          apiUrl: "https://api.example.com/v1/api",
          mcpUrl: "https://api.example.com/v1/mcp",
          rateLimit: { requests: 60, windowSeconds: 60 },
        });
      return;
    }
    if (
      path.startsWith("/v1/core/settings/api-keys/") &&
      request.method === "DELETE"
    ) {
      const key = apiKeys.find((key) => key.id === path.split("/").at(-1));
      if (key) key.revokedAt = new Date().toISOString();
      response.writeHead(204);
      response.end();
      return;
    }
    if (path === "/v1/core/aws" && request.method === "PUT") {
      void readRequestJson(request)
        .then((input) => {
          const values = input as { accessKeyId?: string; region?: string };
          const now = new Date().toISOString();
          awsCredential = {
            accessKeyIdSuffix: values.accessKeyId?.slice(-4) ?? "ABCD",
            createdAt: now,
            lastVerifiedAt: now,
            region: values.region ?? "ap-south-1",
            status: "verified",
            updatedAt: now,
            verificationMessage: "AWS identity verified",
          };
          return writeJson(response, 200, { credential: awsCredential });
        })
        .catch(() => writeJson(response, 400, { error: "Invalid JSON" }));
      return;
    }
    if (path === "/v1/core/aws" && request.method === "DELETE") {
      awsCredential = null;
      response.writeHead(204);
      response.end();
      return;
    }
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
      if (awsCredential) awsCredential.lastVerifiedAt = checkedAt;
      return writeJson(response, 200, fixtureSystemHealth());
    }
    if (request.method === "POST" && path === "/v1/core/sources") {
      return writeJson(response, 201, { source });
    }
    if (request.method === "POST" && path === "/v1/core/servers") {
      void readRequestJson(request)
        .then((input) => {
          const config = input as Server["config"];
          if (servers.some((item) => item.canonicalIp === config.ip)) {
            return writeJson(response, 409, {
              error: { message: `Server '${config.ip}' is already configured` },
            });
          }
          const server = createServerFixture(
            randomUUID(),
            config.ip,
            config.ssh.username,
            false,
          );
          server.config = {
            ...config,
            buildConcurrency: config.buildConcurrency ?? 1,
            previewBuildConcurrency: config.previewBuildConcurrency ?? 1,
            ssh: {
              host: config.ssh.host ?? config.ip,
              port: config.ssh.port ?? 22,
              username: config.ssh.username,
            },
          };
          servers.push(server);
          hostKeysByServer.set(server.id, []);
          serverPreparationsByServer.set(server.id, []);
          runtimeCapacity.push(emptyRuntimeCapacity(server));
          return writeJson(response, 201, { server });
        })
        .catch(() =>
          writeJson(response, 400, {
            error: { message: "Invalid server configuration" },
          }),
        );
      return;
    }
    const serverMutationMatch = path.match(/^\/v1\/core\/servers\/([^/]+)$/);
    if (serverMutationMatch && request.method === "PATCH") {
      const server = servers.find((item) => item.id === serverMutationMatch[1]);
      if (!server) return writeNotFound(response);
      void readRequestJson(request)
        .then((input) => {
          const config = input as Server["config"];
          if (config.ip !== server.canonicalIp) {
            return writeJson(response, 409, {
              error: {
                message: "Add a new server to use a different IP address",
              },
            });
          }
          server.config = config;
          server.setupStatus = "pending";
          server.updatedAt = new Date().toISOString();
          return writeJson(response, 200, { server });
        })
        .catch(() =>
          writeJson(response, 400, {
            error: { message: "Invalid server configuration" },
          }),
        );
      return;
    }
    if (serverMutationMatch && request.method === "DELETE") {
      return writeNotFound(response);
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
              kind === "sources" ? "source" : "deployable",
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
    const mutationMatch = path.match(
      /^\/v1\/core\/(sources|apps|resources)\/([^/]+)\/secrets\/(production|preview)\/(build|deployment|pre_deploy|post_deploy)$/,
    );
    const globalSecretMutationMatch = path.match(
      /^\/v1\/core\/settings\/secrets\/(production|preview)\/(build|deployment|pre_deploy|post_deploy)$/,
    );
    const credentialMatch = path.match(
      /^\/v1\/core\/servers\/([^/]+)\/credentials$/,
    );
    if (
      request.method === "PATCH" &&
      (mutationMatch || globalSecretMutationMatch || credentialMatch)
    ) {
      const key = mutationMatch
        ? `${mutationMatch[2]}:${mutationMatch[3]}:${mutationMatch[4]}`
        : globalSecretMutationMatch
          ? `${user.workspaceId}:${globalSecretMutationMatch[1]}:${globalSecretMutationMatch[2]}`
          : `credentials:${credentialMatch![1]}`;
      void readRequestJson(request)
        .then((input) => {
          const payload = input as {
            expectedRevision: string | null;
            set?: Record<string, string>;
            delete?: string[];
          };
          if (
            payload.expectedRevision !==
            (fixtureSecretVersions.get(key) ?? null)
          )
            return writeJson(response, 409, {
              error: {
                message:
                  "These secrets changed after loading. Refresh before saving.",
              },
            });
          applyFixtureSecretMutation(key, payload);
          return writeJson(response, 200, {
            secret: fixtureMetadata(key),
            credential: fixtureMetadata(key),
          });
        })
        .catch(() =>
          writeJson(response, 400, {
            error: { message: "Invalid secret changes" },
          }),
        );
      return;
    }
    if (request.method === "GET" && credentialMatch)
      return writeJson(response, 200, {
        credential: fixtureMetadata(`credentials:${credentialMatch[1]}`),
        canManage: true,
      });
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
    const checkServerMatch = path.match(
      /^\/v1\/core\/servers\/([^/]+)\/actions\/check$/,
    );
    if (request.method === "POST" && checkServerMatch) {
      const server = servers.find((item) => item.id === checkServerMatch[1]);
      if (!server) return writeNotFound(response);
      return writeJson(response, 202, {
        check: {
          createdAt: new Date().toISOString(),
          errorCode: null,
          errorMessage: null,
          finishedAt: null,
          id: randomUUID(),
          result: null,
          startedAt: null,
          status: "queued",
        } satisfies ServerCheck,
      });
    }
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
    const restoreActionMatch = path.match(
      /^\/v1\/core\/resources\/([^/]+)\/actions\/restore$/,
    );
    if (request.method === "POST" && restoreActionMatch) {
      const resource = resources.find(
        (item) => item.id === restoreActionMatch[1],
      );
      if (!resource) return writeNotFound(response);
      void readRequestJson(request)
        .then((input) => {
          const payload = input as {
            backupId?: string;
            confirmation?: string;
            reason?: string;
          };
          const backup = sourceBackups.find(
            (item) =>
              item.id === payload.backupId && item.resourceId === resource.id,
          );
          if (!backup || payload.confirmation !== resource.name) {
            return writeJson(response, 422, {
              error: { message: "Backup or confirmation is invalid" },
            });
          }
          const now = new Date().toISOString();
          const operation: ResourceOperation = {
            cancelRequestedAt: null,
            createdAt: now,
            deletedAt: null,
            errorCode: null,
            errorMessage: null,
            finishedAt: null,
            id: randomUUID(),
            phase: "restoring_candidate",
            request: {
              backupId: backup.id,
              reason: payload.reason ?? "Fixture restore request",
              type: "restore",
            },
            requestedBy: user.id,
            resourceId: resource.id,
            result: null,
            serverId: resource.serverId,
            sourceId: resource.sourceId,
            startedAt: now,
            state: "running",
            type: "restore",
            updatedAt: now,
          };
          runtimeOperations.unshift(operation);
          operationEventsByOperation.set(operation.id, [
            {
              command: "docker inspect <active-runtime>",
              createdAt: now,
              id: randomUUID(),
              level: "success",
              message: "Backup, server, and active runtime passed preflight",
              metadata: {},
              phase: "preflight",
              sequence: 1,
            },
            {
              command: null,
              createdAt: now,
              id: randomUUID(),
              level: "info",
              message: "Restoring into an isolated candidate volume",
              metadata: {},
              phase: "restoring_candidate",
              sequence: 2,
            },
          ]);
          return writeJson(response, 202, { operation });
        })
        .catch(() =>
          writeJson(response, 400, {
            error: { message: "Request body must be valid JSON" },
          }),
        );
      return;
    }
    const restoreCleanupMatch = path.match(
      /^\/v1\/core\/resources\/([^/]+)\/actions\/restore-cleanup$/,
    );
    if (request.method === "POST" && restoreCleanupMatch) {
      const resource = resources.find(
        (item) => item.id === restoreCleanupMatch[1],
      );
      if (!resource) return writeNotFound(response);
      const now = new Date().toISOString();
      const operation: ResourceOperation = {
        cancelRequestedAt: null,
        createdAt: now,
        deletedAt: null,
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
        id: randomUUID(),
        phase: null,
        request: { type: "restore_cleanup" },
        requestedBy: user.id,
        resourceId: resource.id,
        result: {
          cleanedVolumes: ["towbar-fixture-previous"],
          restoreId: "fixture-restore",
          skippedVolumes: [],
        },
        serverId: resource.serverId,
        sourceId: resource.sourceId,
        startedAt: now,
        state: "succeeded",
        type: "restore_cleanup",
        updatedAt: now,
      };
      runtimeOperations.unshift(operation);
      return writeJson(response, 202, { operation });
    }
    const cancelRestoreMatch = path.match(
      /^\/v1\/core\/resources\/([^/]+)\/operations\/([^/]+)\/actions\/cancel$/,
    );
    if (request.method === "POST" && cancelRestoreMatch) {
      const operation = runtimeOperations.find(
        (item) =>
          item.resourceId === cancelRestoreMatch[1] &&
          item.id === cancelRestoreMatch[2] &&
          item.type === "restore",
      );
      if (!operation) return writeNotFound(response);
      operation.cancelRequestedAt = new Date().toISOString();
      operation.state = "cancelled";
      operation.phase = "cancelled";
      operation.finishedAt = operation.cancelRequestedAt;
      operation.updatedAt = operation.cancelRequestedAt;
      return writeJson(response, 200, { operation });
    }
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
        cancelRequestedAt: null,
        createdAt: now,
        deletedAt: null,
        errorCode: null,
        errorMessage: null,
        finishedAt: now,
        id: randomUUID(),
        phase: null,
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
    const previewDeployMatch = path.match(
      /^\/v1\/core\/previews\/([^/]+)\/actions\/deploy$/,
    );
    if (request.method === "POST" && previewDeployMatch) {
      const preview = previews.find(
        (item) => item.id === previewDeployMatch[1],
      );
      if (!preview) return writeNotFound(response);
      return writeJson(response, 202, {
        accepted: true,
        deploymentId: randomUUID(),
      });
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
      if (!deployable.serverReady)
        return writeJson(response, 409, {
          error: {
            code: "SERVER_NOT_READY",
            message: "Prepare the server before deploying",
          },
        });
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
    const vulnerabilityRescanMatch = path.match(
      /^\/v1\/core\/deployments\/([^/]+)\/vulnerability-scan\/actions\/rescan$/,
    );
    if (request.method === "POST" && vulnerabilityRescanMatch) {
      const deployment = deployments.find(
        (item) => item.id === vulnerabilityRescanMatch[1],
      );
      if (!deployment?.vulnerabilityScan) return writeNotFound(response);
      deployment.vulnerabilityScan = {
        ...deployment.vulnerabilityScan,
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        requestedAt: new Date().toISOString(),
        startedAt: null,
        state: "pending",
      };
      return writeJson(response, 202, {
        replayed: false,
        scan: deployment.vulnerabilityScan,
      });
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
  if (path === "/v1/core/deployments/history") {
    const page = readPositiveInteger(searchParams.get("page"), 1);
    const limit = Math.min(
      100,
      readPositiveInteger(searchParams.get("limit"), 10),
    );
    const ordered = [...deployments].sort(
      (left, right) =>
        right.createdAt.localeCompare(left.createdAt) ||
        right.id.localeCompare(left.id),
    );
    const deployables = new Map(
      [...apps, ...resources].map((item) => [item.id, item]),
    );
    return {
      deployments: ordered
        .slice((page - 1) * limit, page * limit)
        .map((item) => ({
          ...item,
          deployableName:
            deployables.get(item.appId)?.name ?? "Unknown workload",
        })),
      pagination: {
        page,
        limit,
        total: ordered.length,
        totalPages: Math.ceil(ordered.length / limit),
      },
    };
  }
  const extraSourceMatch = path.match(
    /^\/v1\/core\/sources\/([^/]+)(?:\/(.*))?$/,
  );
  const extraSource = sources.find(
    (item) => item.id !== source.id && item.id === extraSourceMatch?.[1],
  );
  if (extraSource) {
    const sourceApps = apps.filter((item) => item.sourceId === extraSource.id);
    const sourceResources = resources.filter(
      (item) => item.sourceId === extraSource.id,
    );
    const child = extraSourceMatch?.[2];
    if (!child) return { canManageSource: true, source: extraSource };
    if (child === "apps") return { apps: sourceApps };
    if (child === "resources") return { resources: sourceResources };
    if (child === "manifest") return { manifest: null };
    if (child === "syncs") return { syncs: [] };
    if (child === "deployments") return { deployments: [] };
    if (child === "previews") return { previews: [] };
    if (child === "backups") return { backups: [] };
    if (child === "capacity")
      return {
        capacities: runtimeCapacity.filter((capacity) =>
          [...sourceApps, ...sourceResources].some(
            (item) => item.serverIp === capacity.ip,
          ),
        ),
      };
    if (child === "notifications/destinations")
      return {
        canManageNotifications: true,
        destinations: [],
        providers: { slack: false, smtp: false },
      };
    if (child === "secrets")
      return getFixtureSourceSecrets(
        searchParams.get("environment") === "preview"
          ? "preview"
          : "production",
      );
  }
  const fixedPayloads = new Map<string, unknown>([
    [
      "/v1/core/notifications/providers",
      { providers: { slack: false, smtp: false } },
    ],
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
    ["/v1/core/sources", { sources }],
    ["/v1/core/apps", { apps }],
    ["/v1/core/resources", { resources }],
    ["/v1/core/servers", { servers }],
    ["/v1/core/system-health", fixtureSystemHealth()],
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
          manifest: { apps: [], resources: [], version: 1 },
          manifestDigest,
          rawManifest: "version: 1\napps: []\nresources: []\n",
        },
      },
    ],
    [`/v1/core/sources/${source.id}/syncs`, { syncs: [sourceSync] }],
    ["/v1/core/aws", { canManage: true, credential: awsCredential }],
    [
      `/v1/core/sources/${source.id}/apps`,
      { apps: apps.filter((item) => item.sourceId === source.id) },
    ],
    [`/v1/core/sources/${source.id}/capacity`, { capacities: runtimeCapacity }],
    [`/v1/core/sources/${source.id}/previews`, { previews }],
    [
      `/v1/core/sources/${source.id}/resources`,
      { resources: resources.filter((item) => item.sourceId === source.id) },
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
        providers: { slack: false, smtp: false },
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

  const deploymentMatch = path.match(
    /^\/v1\/core\/deployments\/([^/]+)(?:\/(steps|logs))?$/,
  );
  const vulnerabilityFindingsMatch = path.match(
    /^\/v1\/core\/deployments\/([^/]+)\/vulnerability-scan\/findings$/,
  );
  if (vulnerabilityFindingsMatch) {
    const deployment = deployments.find(
      (item) => item.id === vulnerabilityFindingsMatch[1],
    );
    return deployment?.vulnerabilityScan
      ? { findings: vulnerabilityFindings }
      : undefined;
  }
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

  if (path === "/v1/core/settings/secrets") {
    return getFixtureGlobalSecrets(
      searchParams.get("environment") === "preview" ? "preview" : "production",
    );
  }

  if (path === `/v1/core/sources/${source.id}/secrets`) {
    return getFixtureSourceSecrets(
      searchParams.get("environment") === "preview" ? "preview" : "production",
    );
  }

  const deployableSecretsMatch = path.match(
    /^\/v1\/core\/(apps|resources)\/([^/]+)\/secrets$/,
  );
  if (deployableSecretsMatch) {
    const deployable =
      deployableSecretsMatch[1] === "apps"
        ? apps.find((item) => item.id === deployableSecretsMatch[2])
        : resources.find((item) => item.id === deployableSecretsMatch[2]);
    return deployable
      ? getFixtureDeployableSecrets(
          deployable,
          searchParams.get("environment") === "preview"
            ? "preview"
            : "production",
        )
      : undefined;
  }

  const backupAssuranceMatch = path.match(
    /^\/v1\/core\/resources\/([^/]+)\/backup-assurance$/,
  );
  if (backupAssuranceMatch) {
    const resourceId = backupAssuranceMatch[1]!;
    const assurances = backupAssurances.filter(
      (assurance) => assurance.resourceId === resourceId,
    );
    return {
      assurance: assurances[0] ?? null,
      assurances,
      awsConfigured: Boolean(awsCredential),
      canRestore: true,
    };
  }

  const operationEventsMatch = path.match(
    /^\/v1\/core\/resources\/([^/]+)\/operations\/([^/]+)\/events$/,
  );
  if (operationEventsMatch) {
    return {
      events: operationEventsByOperation.get(operationEventsMatch[2]!) ?? [],
    };
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
    if (child === "operations") {
      return {
        operations: runtimeOperations.filter(
          (operation) => operation.resourceId === id,
        ),
      };
    }
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
    return { canCleanupOrphans: true, canManageServer: true, server };
  }

  return undefined;
}

function createAutoDeployControlFixture(
  targetType: "app" | "resource" | "source",
): AutoDeployControlResponse["autoDeploy"] {
  return {
    ...(targetType === "source" ? {} : { manifestAutoDeployEnabled: true }),
    effective: {
      paused: false,
      pending: null,
      scope: null,
    },
    paused: false,
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
    refreshFixtureAutoDeployEffectiveState(control, "deployable");
    deployableAutoDeployControls.set(id, control);
  }
  return control;
}

function applyFixtureAutoDeployControlPatch(
  target: AutoDeployControlResponse["autoDeploy"],
  patch: Record<string, unknown>,
  targetType: "deployable" | "source",
) {
  if (typeof patch.paused === "boolean") {
    target.paused = patch.paused;
  }
  refreshFixtureAutoDeployEffectiveState(target, targetType);
  if (targetType === "source") {
    for (const deployable of deployableAutoDeployControls.values()) {
      refreshFixtureAutoDeployEffectiveState(deployable, "deployable");
    }
  }
}

function refreshFixtureAutoDeployEffectiveState(
  target: AutoDeployControlResponse["autoDeploy"],
  targetType: "deployable" | "source",
) {
  if (targetType === "deployable" && sourceAutoDeployControl.paused) {
    target.effective = {
      paused: true,
      pending: target.effective.pending,
      scope: "source",
    };
    return;
  }
  if (target.paused) {
    target.effective = {
      paused: true,
      pending: target.effective.pending,
      scope: targetType === "source" ? "source" : "deployable",
    };
    return;
  }
  target.effective = {
    paused: false,
    pending: null,
    scope: null,
  };
}

function readPositiveInteger(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function fixtureMetadata(key: string) {
  return {
    keys: fixtureSecretKeys.get(key) ?? [],
    revision: fixtureSecretVersions.get(key) ?? null,
    updatedAt: fixtureNow,
  };
}
function getFixtureDeployableSecrets(
  deployable: FixtureApp | FixtureResource,
  environment: "production" | "preview" = "production",
): AppSecretsResponse {
  return getFixtureSecretsResponse(
    deployable.id,
    environment,
    deployable.kind !== "app",
  );
}
function getFixtureGlobalSecrets(
  environment: "production" | "preview",
): AppSecretsResponse {
  return getFixtureSecretsResponse(
    user.workspaceId,
    environment,
    false,
    "global",
  );
}
function getFixtureSourceSecrets(
  environment: "production" | "preview",
): AppSecretsResponse {
  return getFixtureSecretsResponse(source.id, environment, false, "source");
}
function getFixtureSecretsResponse(
  id: string,
  environment: "production" | "preview",
  resource: boolean,
  scope: "global" | "source" | "deployable" = "deployable",
): AppSecretsResponse {
  const stages = resource
    ? ["deployment" as const]
    : (["build", "deployment", "pre_deploy", "post_deploy"] as const);
  return {
    canManageSecrets: true,
    bindings: stages.map((stage) => {
      const local = fixtureMetadata(`${id}:${environment}:${stage}`);
      const global =
        scope !== "global"
          ? fixtureMetadata(`${user.workspaceId}:${environment}:${stage}`)
          : { keys: [], revision: null };
      const shared =
        scope === "deployable"
          ? fixtureMetadata(`${source.id}:production:${stage}`)
          : { keys: [], revision: null };
      if (scope === "deployable" && environment === "preview") {
        Object.assign(shared, fixtureMetadata(`${source.id}:preview:${stage}`));
      }
      const inheritedKeys = [
        ...new Set([...global.keys, ...shared.keys]),
      ].sort();
      return {
        ...local,
        environment,
        stage,
        inheritedKeys,
        inheritedOrigins: Object.fromEntries([
          ...global.keys.map((key) => [key, "global"] as const),
          ...shared.keys.map((key) => [key, "source"] as const),
        ]),
        inheritedRevisions: {
          global: global.revision,
          source: shared.revision,
        },
        pendingChanges: scope === "deployable" && Boolean(local.revision),
        affectedDeployables:
          environment === "preview"
            ? previews
                .filter(
                  (preview) =>
                    preview.appId === id &&
                    ["healthy", "failed", "building"].includes(preview.status),
                )
                .map((preview) => ({
                  id: preview.id,
                  name: `PR #${preview.pullRequestNumber}`,
                  kind: "preview" as const,
                }))
            : scope === "source"
              ? [...apps, ...resources]
                  .filter(
                    (item) => stage === "deployment" || item.kind === "app",
                  )
                  .map((item) => ({
                    id: item.id,
                    name: item.name,
                    kind:
                      item.kind === "app"
                        ? ("app" as const)
                        : ("resource" as const),
                  }))
              : [],
      };
    }),
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
    hardware:
      id === fixtureIds.server
        ? {
            instance: { provider: "aws", type: "m6i.xlarge" },
            cpuCount: 4,
            memoryBytes: 17_179_869_184,
          }
        : id === fixtureIds.secondaryServer
          ? { instance: null, cpuCount: 8, memoryBytes: 34_359_738_368 }
          : null,
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
    updatedAt: fixtureNow,
  };
}

function emptyRuntimeCapacity(server: Server): RuntimeCapacity {
  return {
    checkedAt: null,
    cpu: null,
    disk: null,
    id: server.id,
    ip: server.canonicalIp,
    latestCheckStatus: null,
    memory: null,
    runtimes: [],
    status: "unknown",
    uptimeSeconds: null,
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

      ...(id === fixtureIds.app
        ? {
            preview: {
              domain: "preview.example.com",
              enabled: true as const,

              ttlHours: 72,
            },
          }
        : {}),
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
    cancelRequestedAt: null,
    createdAt,
    deletedAt: null,
    errorCode: null,
    errorMessage: null,
    finishedAt: createdAt,
    id,
    phase: null,
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
      engine: resource.kind === "redis" ? "redis" : "postgres",
      engineMajorVersion: resource.kind === "redis" ? 8 : 18,
      format: resource.kind === "redis" ? "redis-rdb" : "postgres-custom",
      key,
      metadataVersion: 1,
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
  const scanCompletedAt = new Date(
    new Date(createdAt).getTime() + 102_000,
  ).toISOString();
  const startedAt = state === "queued" ? null : createdAt;
  const imageDigest = `sha256:${id.replaceAll("-", "").repeat(2)}`;
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
    imageDigest:
      state === "succeeded" || state === "succeeded_with_warnings"
        ? imageDigest
        : null,
    imagePlatform:
      state === "succeeded" || state === "succeeded_with_warnings"
        ? "linux/arm64"
        : null,
    kind: trigger === "rollback" ? "rollback" : "deploy",
    manifestDigest,
    serverId: server.id,
    sourceId: deployable.sourceId,
    sourceInputDigest: "f".repeat(64),
    startedAt,
    state,
    trigger,
    updatedAt: createdAt,
    vulnerabilityScan:
      state === "succeeded" || state === "succeeded_with_warnings"
        ? createVulnerabilityScanFixture({
            completedAt: scanCompletedAt,
            createdAt,
            id,
            imageDigest,
          })
        : null,
    vulnerabilityScanningEnabled: true,
  };
}

function createVulnerabilityScanFixture(input: {
  completedAt: string;
  createdAt: string;
  id: string;
  imageDigest: string;
}): VulnerabilityScan {
  const state = (
    ["findings", "clean", "failed", "stale", "pending", "running"] as const
  )[Number.parseInt(input.id.at(-1) ?? "0", 16) % 6]!;
  const completed = ["clean", "findings", "failed", "stale"].includes(state);
  const findings = state === "findings" || state === "stale";
  const scannerStarted = state !== "pending";
  return {
    completedAt: completed ? input.completedAt : null,
    errorCode: state === "failed" ? "VULNERABILITY_SCAN_FAILED" : null,
    errorMessage:
      state === "failed"
        ? "The scanner could not refresh its vulnerability database."
        : null,
    findingsTruncated: false,
    id: `a${input.id.slice(1)}`,
    imageDigest: input.imageDigest,
    requestedAt: input.createdAt,
    scannerName: scannerStarted ? "trivy" : null,
    scannerVersion: scannerStarted ? "0.74.0" : null,
    severityTotals: findings
      ? { critical: 0, high: 1, low: 2, medium: 1, unknown: 0 }
      : { critical: 0, high: 0, low: 0, medium: 0, unknown: 0 },
    startedAt: scannerStarted ? input.createdAt : null,
    state,
    vulnerabilityDatabaseUpdatedAt: scannerStarted
      ? state === "stale"
        ? "2026-07-01T00:00:00.000Z"
        : "2026-08-14T00:00:00.000Z"
      : null,
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

const allowedFixtureOrigins = new Set([
  "http://127.0.0.1:4021",
  "http://[::1]:4021",
  "http://localhost:4021",
]);

function authorizeFixtureCorsRequest(
  response: ServerResponse,
  origin?: string,
) {
  response.setHeader("vary", "Origin");
  if (!origin) return true;
  if (!allowedFixtureOrigins.has(origin)) {
    writeJson(response, 403, {
      error: { message: "Origin is not allowed by the local fixture API" },
    });
    return false;
  }

  response.setHeader("access-control-allow-origin", origin);
  response.setHeader("access-control-allow-credentials", "true");
  response.setHeader(
    "access-control-allow-headers",
    "content-type,idempotency-key,last-event-id",
  );
  response.setHeader(
    "access-control-allow-methods",
    "DELETE,GET,OPTIONS,PATCH,POST,PUT",
  );
  return true;
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
