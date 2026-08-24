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
    dependsOn?: string[];
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
        secrets?: string;
        timeoutSeconds: number;
      };
      preDeploy?: {
        command: string[];
        secrets?: string;
        timeoutSeconds: number;
      };
    };
    id: string;
    name: string;
    secrets: { build?: string; deployment?: string };
    server: string;
    sharedSecrets?: { build: string[]; deployment: string[] };
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

export type AppSecretUse = {
  scope: "app" | "shared";
  stage: AppSecretStage;
};

export type AppSecretBinding = {
  affectedDeployables: Array<{
    id: string;
    kind: "app" | "resource";
    manifestId: string;
    name: string;
    uses: AppSecretUse[];
  }>;
  changedAt: string | null;
  editable: boolean;
  errorMessage: string | null;
  keys: string[];
  provider: "aws";
  providerReference: string;
  reference: string;
  status: "available" | "unavailable";
  uses: AppSecretUse[];
  versionId: string | null;
};

export type AppSecretsResponse = {
  bindings: AppSecretBinding[];
  canManageSecrets: boolean;
};

export type AppSecretRevealResponse = {
  secret: {
    changedAt: string;
    values: Record<string, string>;
    versionId: string;
  };
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
    dependsOn?: string[];
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
    secrets: { deployment?: string };
    server: string;
    sharedSecrets?: { build: string[]; deployment: string[] };
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
  key: string;
  region: string;
  sizeBytes: number;
  verifiedAt: string;
  warnings: string[];
};

export type ResourceOperation = {
  createdAt: string;
  deletedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  request: Record<string, unknown> & { type: ResourceOperationType };
  requestedBy: string | null;
  resourceId: string | null;
  result:
    | BackupResult
    | { cleaned: OrphanItem[]; skipped: OrphanItem[] }
    | { logs: string; truncated: boolean }
    | { restoredBackupId: string; verifiedAt: string }
    | { state: "running" | "stopped" }
    | null;
  serverId: string;
  sourceId: string;
  startedAt: string | null;
  state: "queued" | "running" | "succeeded" | "failed";
  type: ResourceOperationType;
  updatedAt: string;
};

export type ResourceOperationType =
  | "backup"
  | "capture_logs"
  | "cleanup_orphans"
  | "restart"
  | "restore"
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
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string | null;
  id: string;
  kind: "deploy" | "rollback";
  manifestDigest: string;
  serverId: string;
  sourceId: string;
  startedAt: string | null;
  state: DeploymentState;
  trigger: "auto_deploy" | "manual" | "rollback";
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
  suspendedAt: string | null;
  updatedAt: string;
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
