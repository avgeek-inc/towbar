import type {
  DeploymentState,
  NormalizedDeployable,
  NormalizedServer,
  OrphanItem,
  ResourceOperationRequest,
  ResourceOperationResult,
  RuntimeDesiredState,
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
  expectedDeployables: Array<{
    connectivity: {
      containerPort: number;
      hostPort: number | null;
      network: string | null;
      networkAlias: string | null;
    } | null;
    deployableId: string;
    desiredState: RuntimeDesiredState;
    health:
      | { command: string[]; timeoutSeconds: number; type: "command" }
      | { path: string; timeoutSeconds: number; type: "http" }
      | { timeoutSeconds: number; type: "container" };
    release: { containerName: string; imageTag: string } | null;
  }>;
  expectedImageTags: string[];
  login: SshLoginSecret;
  sourceId: string;
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
  imageTag: string;
  warnings: string[];
};

export type ServerCheckResult = {
  caddyVersion: string;
  diskAvailableKb: number;
  dockerVersion: string;
  hostKey: TrustedHostKey;
  operatingSystem: string;
  orphans: OrphanItem[];
  runtime: RuntimeInspection[];
};

export type SourceAwsCredential = {
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
  request: ResourceOperationRequest;
  sourceId: string;
  server: NormalizedServer;
  trustedHostKeys: TrustedHostKey[];
};

export type ResourceOperationSecrets = {
  aws: SourceAwsCredential | null;
  login: SshLoginSecret;
  sensitiveValues: string[];
};

export type BackupStorage = {
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
  upload(input: {
    bucket: string;
    encryption: "AES256" | "aws:kms";
    key: string;
    kmsKeyId?: string;
    localPath: string;
    sizeBytes: number;
  }): Promise<void>;
};

export type ResourceOperationExecutorResult = ResourceOperationResult & {
  deletedBackupIds?: string[];
};
