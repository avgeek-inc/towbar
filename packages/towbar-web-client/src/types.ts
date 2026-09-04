export type TowbarUser = {
  email: string;
  id: string;
  name: string;
  workspaceId: string;
  workspaceRole: "member" | "owner";
};

export type Source = {
  branch: string;
  createdAt: string;
  id: string;
  latestCommitSha: string | null;
  latestManifestDigest: string | null;
  repositoryName: string;
  repositoryOwner: string;
  status: "active" | "archived";
  updatedAt: string;
};

export type AutoDeployControlResponse = {
  autoDeploy: {
    effective: {
      paused: boolean;
      pending: {
        commitSha: string;
        deploymentDigest: string;
        deferredAt: string;
        manifestId: string;
        reason: "paused";
        scope: "deployable" | "source";
      } | null;
      scope: "deployable" | "source" | null;
    };
    manifestAutoDeployEnabled?: boolean;
    paused: boolean;
  };
  canManageAutoDeploy: boolean;
};

export type DeploymentPlanAction =
  "archive" | "create" | "no_op" | "restore" | "update";

export type DeploymentPlan = {
  branch: string;
  createdAt: string;
  currentCommitSha: string | null;
  currentManifestDigest: string | null;
  githubCheckError?: string | null;
  githubCheckRunId?: string | null;
  githubCheckStatus: "failed" | "pending" | "published" | null;
  id: string;
  plan: {
    checks: Array<{
      code: string;
      entityId?: string;
      entityKind?: "app" | "resource" | "server" | "source";
      message: string;
      references?: string[];
      status: "failed" | "passed" | "warning";
    }>;
    items: Array<{
      action: DeploymentPlanAction;
      automaticDeployment: boolean;
      changedFields: string[];
      entityId: string;
      entityKind: "app" | "resource" | "server";
      matchedPaths: string[];
      name: string;
      reasons: string[];
    }>;
    status: "blocked" | "ready" | "skipped";
    summary: Record<DeploymentPlanAction, number>;
  };
  pullRequestNumber: number | null;
  sourceId: string;
  status: "blocked" | "ready" | "skipped";
  targetCommitSha: string;
  targetManifestDigest: string | null;
  trigger: "manual" | "pull_request";
};

export type App = {
  archivedAt: string | null;
  config: {
    autoDeploy?: boolean;
    container: {
      network?: string;
      port: number;
      resources?: { cpus: number; memory: string };
    };
    context?: string;
    deploymentInputs?: string[];
    description?: string;
    dockerfile: string;
    domains?: {
      primary: string;
      redirects: Array<{ host: string; status: 301 | 302 }>;
    };
    health: { path: string; timeoutSeconds: number };
    hooks?: {
      postDeploy?: {
        command: string[];
        timeoutSeconds: number;
      };
      preDeploy?: {
        command: string[];
        timeoutSeconds: number;
      };
    };
    id: string;
    name: string;
    preview?: {
      domain: string;
      enabled: true;
      ttlHours: number;
    };
    server: string;
    sourceBranch?: string;
    tls?: { mode: "cloudflare-dns" | "direct" };
  };
  description: string | null;
  id: string;
  kind: "app";
  manifestId: string;
  name: string;
  runtimeState: RuntimeState;
  serverReady: boolean;
  serverIp: string;
  sourceId: string;
  sourceRevision: string;
  updatedAt: string;
};

export type AppSecretStage =
  "build" | "deployment" | "pre_deploy" | "post_deploy";
export type AppSecretBinding = {
  environment: "production" | "preview";
  stage: AppSecretStage;
  keys: string[];
  inheritedKeys: string[];
  revision: string | null;
  inheritedRevision: string | null;
  updatedAt: string | null;
  pendingChanges: boolean;
  affectedDeployables: Array<{
    id: string;
    name: string;
    kind: "app" | "resource" | "preview";
  }>;
};
export type AppSecretsResponse = {
  bindings: AppSecretBinding[];
  canManageSecrets: boolean;
};
export type SecretMetadata = {
  keys: string[];
  revision: string | null;
  updatedAt: string | null;
};

export type NotificationCategory =
  "deployments" | "previews" | "health" | "backups" | "restores";

export type NotificationDestination = {
  categories: NotificationCategory[];
  config:
    | { channelId: string }
    | {
        recipients: string[];
      };
  createdAt: string;
  enabled: boolean;
  id: string;
  provider: "slack" | "smtp";
  sourceId: string;
  updatedAt: string;
};

export type NotificationEvent = {
  category: NotificationCategory | "test";
  createdAt: string;
  id: string;
  occurredAt: string;
  payload: {
    details: Record<string, boolean | number | string | null>;
    entity: { id: string; kind: string; name: string };
    message: string;
    occurredAt: string;
    source: { id: string; name: string };
    title: string;
  };
  type: string;
};

export type Resource = {
  archivedAt: string | null;
  config: {
    access?: { sshTunnel: { hostPort: number } };
    autoDeploy?: boolean;
    backup?: {
      retention: { keepLast: number };
      s3: {
        bucket: string;
        encryption: "AES256" | "aws:kms";
        kmsKeyId?: string;
        prefix: string;
        region?: string;
      };
      schedule?: { cron: string; timezone: "UTC" };
    };
    container: {
      command: string[];
      network?: string;
      networkAlias?: string;
      port?: number;
      resources: { cpus: number; memory: string };
      volumes: Array<{ mountPath: string; name: string }>;
    };
    description?: string;
    domains?: {
      primary: string;
      redirects: Array<{ host: string; status: 301 | 302 }>;
    };
    health:
      | { command: string[]; timeoutSeconds: number; type: "command" }
      | { timeoutSeconds: number; type: "container" }
      | { path: string; timeoutSeconds: number; type: "http" };
    id: string;
    image: string;
    kind: "image" | "postgres" | "redis";
    name: string;
    server: string;
    sourceBranch?: string;
    tls?: { mode: "cloudflare-dns" | "direct" };
  };
  description: string | null;
  id: string;
  kind: "image" | "postgres" | "redis";
  manifestId: string;
  name: string;
  runtimeState: RuntimeState;
  serverReady: boolean;
  serverIp: string;
  sourceId: string;
  sourceRevision: string;
  updatedAt: string;
};

export type Server = {
  archivedAt: string | null;
  canonicalIp: string;
  config: {
    buildConcurrency?: number;
    previewBuildConcurrency?: number;
    ip: string;
    ssh: { host?: string; port: number; username: string };
  };
  createdAt: string;
  id: string;
  preparedAt: string | null;
  setupStatus: "pending" | "preparing" | "ready" | "failed";
  sourceId: string;
  sourceRevision: string;
  updatedAt: string;
};

export type RuntimeState = {
  checkedAt: string | null;
  desiredState: "running" | "stopped";
  driftReasons: string[];
  driftStatus: "drifted" | "in_sync" | "unknown";
  healthStatus: "healthy" | "none" | "starting" | "unhealthy" | "unknown";
  observedContainerName: string | null;
  observedImage: string | null;
  observedState: "missing" | "running" | "stopped" | "unknown";
};

export type OrphanItem = {
  kind: "container" | "image" | "volume";
  name: string;
  reason: string;
};

export type BackupResult = {
  backupId: string;
  bucket: string;
  checksum: string;
  deletedBackupIds: string[];
  encryption: "AES256" | "aws:kms";
  engine?: "postgres" | "redis";
  engineMajorVersion?: number;
  format?: "postgres-custom" | "redis-rdb";
  key: string;
  metadataVersion?: 1;
  objectVersionId?: string;
  region: string;
  sizeBytes: number;
  verifiedAt: string;
  warnings: string[];
};

export type BackupAssurance = {
  backupOperationId: string | null;
  checkedAt: string;
  checks: Array<{ message: string; name: string; passed: boolean }>;
  resourceId: string;
  restoreReady: boolean;
  status: "missing" | "stale" | "not_restore_ready" | "restore_ready";
  updatedAt: string;
};

export type RestoreResult = {
  activeVolumes: Array<{ logicalName: string; volumeName: string }>;
  candidateCleaned: boolean;
  outcome: "promoted" | "candidate_failed" | "rolled_back";
  previousVolumes: Array<{ logicalName: string; volumeName: string }>;
  restoredBackupId: string;
  rollbackAvailableUntil: string | null;
  validation: {
    databaseName: string | null;
    engine: "postgres" | "redis";
    engineMajorVersion: number;
    healthVerified: boolean;
    readable: boolean;
  } | null;
  verifiedAt: string | null;
};

export type ResourceOperationEvent = {
  command: string | null;
  createdAt: string;
  id: string;
  level: "error" | "info" | "success";
  message: string;
  metadata: Record<string, boolean | number | string | null>;
  phase: string;
  sequence: number;
};

export type ResourceOperation = {
  createdAt: string;
  deletedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  cancelRequestedAt: string | null;
  phase: string | null;
  request: Record<string, unknown> & { type: ResourceOperationType };
  requestedBy: string | null;
  resourceId: string | null;
  result:
    | BackupResult
    | { cleaned: OrphanItem[]; skipped: OrphanItem[] }
    | { logs: string; truncated: boolean }
    | RestoreResult
    | {
        cleanedVolumes: string[];
        restoreId: string;
        skippedVolumes: string[];
      }
    | { state: "running" | "stopped" }
    | null;
  serverId: string;
  sourceId: string;
  startedAt: string | null;
  state: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  type: ResourceOperationType;
  updatedAt: string;
};

export type ResourceOperationType =
  | "backup"
  | "capture_logs"
  | "cleanup_orphans"
  | "restart"
  | "restore"
  | "restore_cleanup"
  | "start"
  | "stop";

export type SourceBackup = ResourceOperation & {
  resourceKind: "image" | "postgres" | "redis";
  resourceManifestId: string;
  resourceName: string;
  result: BackupResult;
};

export type DeploymentState =
  | "queued"
  | "waiting_for_server"
  | "preparing"
  | "validating_credentials"
  | "checking_server"
  | "fetching_source"
  | "resolving_secrets"
  | "transferring"
  | "building"
  | "running_pre_deploy"
  | "starting_candidate"
  | "checking_health"
  | "configuring_routing"
  | "provisioning_tls"
  | "checking_public_endpoint"
  | "switching_traffic"
  | "running_post_deploy"
  | "cleaning_up"
  | "succeeded"
  | "succeeded_with_warnings"
  | "skipped"
  | "failed"
  | "cancelled";

export type Deployment = {
  appId: string;
  commitSha: string;
  createdAt: string;
  deployableKind: "app" | "image" | "postgres" | "redis";
  environment: "preview" | "production";
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  gitRef: string | null;
  githubDeploymentId: string | null;
  hostname: string | null;
  imageDigest: string | null;
  imagePlatform: string | null;
  kind: "deploy" | "rollback";
  manifestDigest: string;
  queueBlocker?:
    | "server_capacity"
    | "server_check"
    | "server_operation"
    | "server_preparation"
    | null;
  serverId: string;
  sourceId: string;
  sourceInputDigest: string | null;
  startedAt: string | null;
  state: DeploymentState;
  trigger: "auto_deploy" | "manual" | "rollback";
  updatedAt: string;
  vulnerabilityScan?: VulnerabilityScan | null;
  vulnerabilityScanningEnabled?: boolean;
};

export type VulnerabilitySeverityTotals = {
  critical: number;
  high: number;
  low: number;
  medium: number;
  unknown: number;
};

export type VulnerabilityScan = {
  completedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  findingsTruncated: boolean;
  id: string;
  imageDigest: string;
  requestedAt: string;
  scannerName: string | null;
  scannerVersion: string | null;
  severityTotals: VulnerabilitySeverityTotals;
  startedAt: string | null;
  state: "pending" | "running" | "clean" | "findings" | "failed" | "stale";
  vulnerabilityDatabaseUpdatedAt: string | null;
};

export type VulnerabilityFinding = {
  advisoryId: string;
  fixedVersion: string | null;
  id: string;
  installedVersion: string;
  packageName: string;
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  target: string;
};

export type PreviewEnvironment = {
  appId: string;
  appName: string;
  branch: string;
  cleanupAttempts: number;
  createdAt: string;
  errorMessage: string | null;
  expiresAt: string;
  gitRef: string;
  hostname: string;
  id: string;
  latestCommitSha: string;
  latestDeploymentId: string | null;
  nextCleanupAttemptAt: string | null;
  pullRequestNumber: number;
  pullRequestUrl: string;
  sourceId: string;
  status: "building" | "healthy" | "failed" | "deleting" | "cleanup_failed";
  updatedAt: string;
};

export type DeploymentStep = {
  createdAt: string;
  finishedAt: string | null;
  id: string;
  message: string | null;
  sequence: number;
  startedAt: string | null;
  state: DeploymentState;
  status: "failed" | "running" | "skipped" | "succeeded" | "waiting";
};

export type DeploymentLog = {
  content: string;
  createdAt: string;
  id: string;
  sequence: number;
  stream: "stderr" | "stdout";
};

export type DeploymentEvent = {
  deployment: Deployment;
  logs: DeploymentLog[];
  steps: DeploymentStep[];
};

export type GitHubConnection = {
  accountLogin: string;
  accountType: string;
  id: string;
  installationId: string;
  permissionReadiness:
    | {
        checks: "none" | "read" | "write";
        contents: "none" | "read" | "write";
        deployments: "none" | "read" | "write";
        planning: "missing" | "ready";
        preview: "missing" | "ready";
        pullRequests: "none" | "read" | "write";
        status: "available";
      }
    | { status: "unavailable" };
  suspendedAt: string | null;
  updatedAt: string;
};

export type PreviewReportingHealth = {
  failedCount: number;
  lastError: string | null;
  lastFailedAt: string | null;
};

export type GitHubRepository = {
  defaultBranch: string;
  fullName: string;
  id: string;
  name: string;
  owner: string;
  private: boolean;
};

export type AwsCredentialMetadata = {
  accessKeyIdSuffix: string;
  createdAt: string;
  lastVerifiedAt: string | null;
  region: string;
  status: "unverified" | "verified" | "failed";
  updatedAt: string;
  verificationMessage: string | null;
};

export type SourceSync = {
  commitSha: string | null;
  createdAt: string;
  finishedAt: string | null;
  id: string;
  issues: unknown[] | null;
  manifestDigest: string | null;
  reconciliation: unknown;
  startedAt: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
};

export type ServerCheck = {
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
};

export type PaginationMetadata = {
  limit: number;
  page: number;
  total: number;
  totalPages: number;
};

export type ServerChecksPage = {
  checks: ServerCheck[];
  latestCheck: ServerCheck | null;
  pagination: PaginationMetadata;
};

export type ServerPreparationStep = {
  finishedAt: string | null;
  id:
    | "connecting"
    | "inspecting"
    | "installing_prerequisites"
    | "installing_docker"
    | "installing_caddy"
    | "configuring_access"
    | "verifying";
  message: string | null;
  startedAt: string | null;
  status: "waiting" | "running" | "succeeded" | "failed";
  title: string;
};

export type ServerPreparation = {
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  result: Record<string, unknown> | null;
  startedAt: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  steps: ServerPreparationStep[];
};

export type SourceServer = Server & {
  hostKeyStatus: "trusted" | "untrusted";
};

export type TrustedHostKey = {
  algorithm: string;
  createdAt: string;
  fingerprint: string;
  id: string;
};

export type Release = {
  appId: string;
  commitSha: string;
  containerName: string;
  deploymentId: string;
  id: string;
  imageDigest: string | null;
  imagePlatform: string | null;
  imageTag: string;
  promotedAt: string;
  status: "current" | "previous" | "superseded";
  supersededAt: string | null;
};

export type UserSession = {
  createdAt: string;
  expiresAt: string;
  id: string;
  lastSeenAt: string;
  revokedAt: string | null;
};
