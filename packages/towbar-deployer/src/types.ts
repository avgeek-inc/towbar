import type {
  DeploymentState,
  NormalizedDeployable,
  NormalizedServer,
  OrphanItem,
  ResourceOperationRequest,
  ResourceOperationResult,
  RuntimeExpectation,
  RuntimeInspection,
  ServerPreparationStepId,
  ServerPreparationStepStatus,
} from "@workspace/towbar-core";

export type SshLoginSecret = {
  privateKey: string;
};

export type DeploymentSecrets = {
  build: Record<string, string>;
  cloudflare: { apiToken: string } | null;
  hooks: {
    postDeploy: Record<string, string>;
    preDeploy: Record<string, string>;
  };
  login: SshLoginSecret;
  runtime: Record<string, string>;
};

export type DeploymentExecutionContext = {
  app: NormalizedDeployable;
  commitSha: string;
  deploymentId: string;
  deployableId: string;
  environment?: "preview" | "production";
  gitRef?: string | null;
  githubToken: string | null;
  kind: "deploy" | "rollback";
  repositoryName: string;
  repositoryOwner: string;
  runtimeId?: string;
  sourceId: string;
  rollbackRelease: {
    commitSha: string;
    containerName: string;
    imageTag: string;
    releaseId: string;
    sourceDeploymentId: string;
  } | null;
  currentRelease: {
    containerName: string;
    imageTag: string;
  } | null;
  server: NormalizedServer;
  trustedHostKeys: TrustedHostKey[];
};

export type TrustedHostKey = {
  algorithm: string;
  fingerprint: string;
  publicKey: string;
};

export type PreviewCleanupContext = {
  containerNames: string[];
  hostname: string;
  imageTags: string[];
  previewEnvironmentId: string;
  runtimeId: string;
  server: NormalizedServer;
  trustedHostKeys: TrustedHostKey[];
};

export type ServerCheckContext = {
  checkId: string;
  config: NormalizedServer;
  expectedContainerNames: string[];
  expectedDeployables: RuntimeExpectation[];
  expectedImageTags: string[];
  login: SshLoginSecret;
  trustedHostKeys: TrustedHostKey[];
};

export type ServerPreparationContext = {
  config: NormalizedServer;
  login: SshLoginSecret;
  preparationId: string;
  trustedHostKeys: TrustedHostKey[];
};

export type ServerPreparationHooks = {
  step: (input: {
    id: ServerPreparationStepId;
    message: string;
    status: Exclude<ServerPreparationStepStatus, "waiting">;
  }) => Promise<void>;
};

export type ServerPreparationResult = {
  caddyVersion: string;
  diskAvailableKb: number;
  dockerVersion: string;
  operatingSystem: string;
  pythonVersion: string;
};

export type ExecutorHooks = {
  commitRelease?: (result: DeploymentResult) => Promise<ReleaseCommitResult>;
  heartbeat?: (details: { state: DeploymentState }) => void;
  log?: (content: string, stream: "stderr" | "stdout") => Promise<void>;
  transition?: (state: DeploymentState, message: string) => Promise<void>;
};

export type ReleaseCommitResult = {
  retainedImageTags: string[];
};

export type DeploymentResult = {
  candidatePort: number;
  containerName: string;
  imageDigest: string;
  imagePlatform: string;
  imageTag: string;
  warnings: string[];
};

export type ServerCheckResult = {
  caddyVersion: string;
  diskAvailableKb: number;
  host: {
    instance?: import("@workspace/towbar-core").CloudInstance | null;
    cpuLogicalCount: number;
    cpuUsagePercent: number;
    diskAvailableKb: number;
    diskTotalKb: number;
    loadAverage1m: number;
    memoryAvailableKb: number;
    memoryTotalKb: number;
    uptimeSeconds: number;
  };
  dockerVersion: string;
  hostKey: TrustedHostKey;
  operatingSystem: string;
  orphans: OrphanItem[];
  runtime: RuntimeInspection[];
};

export type WorkspaceAwsCredential = {
  accessKeyId: string;
  region: string;
  secretAccessKey: string;
};

export type ResourceOperationExecutionContext = {
  cleanupExpected: {
    containerNames: string[];
    deployableIds: string[];
    imageTags: string[];
  };
  currentRelease: {
    containerName: string;
    imageTag: string;
    releaseId: string;
  } | null;
  deployable: NormalizedDeployable | null;
  deployableId: string | null;
  operationId: string;
  retentionBackups: Array<{ bucket: string; id: string; key: string }>;
  restoreBackup: {
    createdAt: string;
    id: string;
    result: import("@workspace/towbar-core").BackupOperationResult;
  } | null;
  request: ResourceOperationRequest;
  sourceId: string;
  server: NormalizedServer;
  trustedHostKeys: TrustedHostKey[];
};

export type ResourceOperationSecrets = {
  aws: WorkspaceAwsCredential | null;
  login: SshLoginSecret;
  runtime: Record<string, string>;
  sensitiveValues: string[];
};

export type BackupStorage = {
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  download(input: {
    bucket: string;
    key: string;
    localPath: string;
    versionId?: string;
  }): Promise<void>;
  headObject(input: {
    bucket: string;
    key: string;
    versionId?: string;
  }): Promise<{
    checksum?: string;
    engine?: "postgres" | "redis";
    engineMajorVersion?: number;
    encryption?: "AES256" | "aws:kms";
    exists: boolean;
    format?: "postgres-custom" | "redis-rdb";
    metadataVersion?: number;
    sizeBytes?: number;
  }>;
  upload(input: {
    bucket: string;
    encryption: "AES256" | "aws:kms";
    key: string;
    kmsKeyId?: string;
    localPath: string;
    metadata: Record<string, string>;
    sizeBytes: number;
  }): Promise<{ versionId?: string }>;
};

export type ResourceOperationHooks = {
  progress?: (input: {
    command?: string;
    level?: "error" | "info" | "success";
    message: string;
    metadata?: Record<string, boolean | number | string | null>;
    phase: import("@workspace/towbar-core").RestoreOperationPhase;
  }) => Promise<void>;
};

export type ResourceOperationExecutorResult = ResourceOperationResult & {
  deletedBackupIds?: string[];
};
