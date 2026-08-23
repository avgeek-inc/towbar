import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { deploymentStates } from "@workspace/towbar-core/temporal";

import type {
  PersistedResourceOperationRequest,
  ResourceOperationResult,
  EncryptedCredential,
  ManifestIssue,
  ManifestReconciliation,
  NormalizedDeployable,
  NormalizedDeploymentManifest,
  NormalizedServer,
  ServerPreparationStep,
} from "@workspace/towbar-core";

export const workspaceRoleEnum = pgEnum("towbar_workspace_role", [
  "owner",
  "member",
]);
export const sourceStatusEnum = pgEnum("towbar_source_status", [
  "active",
  "archived",
]);
export const sourceSyncStatusEnum = pgEnum("towbar_source_sync_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export const checkStatusEnum = pgEnum("towbar_check_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
]);
export const credentialVerificationStatusEnum = pgEnum(
  "towbar_credential_verification_status",
  ["unverified", "verified", "failed"],
);
export const deploymentStateEnum = pgEnum(
  "towbar_deployment_state",
  deploymentStates,
);
export const deploymentKindEnum = pgEnum("towbar_deployment_kind", [
  "deploy",
  "rollback",
]);
export const deploymentStepStatusEnum = pgEnum(
  "towbar_deployment_step_status",
  ["waiting", "running", "succeeded", "failed", "skipped"],
);
export const releaseStatusEnum = pgEnum("towbar_release_status", [
  "current",
  "previous",
  "superseded",
]);
export const deployableKindEnum = pgEnum("towbar_deployable_kind", [
  "app",
  "image",
  "postgres",
  "redis",
]);
export const resourceOperationTypeEnum = pgEnum(
  "towbar_resource_operation_type",
  [
    "backup",
    "capture_logs",
    "cleanup_orphans",
    "restart",
    "restore",
    "start",
    "stop",
  ],
);
export const resourceOperationStateEnum = pgEnum(
  "towbar_resource_operation_state",
  ["queued", "running", "succeeded", "failed"],
);
export const runtimeDesiredStateEnum = pgEnum("towbar_runtime_desired_state", [
  "running",
  "stopped",
]);
export const runtimeObservedStateEnum = pgEnum(
  "towbar_runtime_observed_state",
  ["missing", "running", "stopped", "unknown"],
);
export const runtimeHealthStateEnum = pgEnum("towbar_runtime_health_state", [
  "healthy",
  "none",
  "starting",
  "unhealthy",
  "unknown",
]);
export const runtimeDriftStateEnum = pgEnum("towbar_runtime_drift_state", [
  "drifted",
  "in_sync",
  "unknown",
]);
export const users = pgTable(
  "towbar_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("uq_towbar_users_email").on(table.email)],
);

export const passwordCredentials = pgTable("towbar_password_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const sessions = pgTable(
  "towbar_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_sessions_token_hash").on(table.tokenHash),
    index("idx_towbar_sessions_user_id").on(table.userId),
    index("idx_towbar_sessions_expires_at").on(table.expiresAt),
  ],
);

export const authCodes = pgTable(
  "towbar_auth_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    redirectUri: text("redirect_uri").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_auth_codes_code_hash").on(table.codeHash),
    index("idx_towbar_auth_codes_expires_at").on(table.expiresAt),
  ],
);

export const passwordResetTokens = pgTable(
  "towbar_password_reset_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_password_reset_token_hash").on(table.tokenHash),
    index("idx_towbar_password_reset_expires_at").on(table.expiresAt),
  ],
);

export const workspaces = pgTable(
  "towbar_workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("uq_towbar_workspaces_slug").on(table.slug)],
);

export const workspaceMembers = pgTable(
  "towbar_workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: workspaceRoleEnum("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId],
      name: "pk_towbar_workspace_members",
    }),
    index("idx_towbar_workspace_members_user_id").on(table.userId),
  ],
);

export const githubInstallations = pgTable(
  "towbar_github_installations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    installationId: varchar("installation_id", { length: 40 }).notNull(),
    accountLogin: varchar("account_login", { length: 255 }).notNull(),
    accountType: varchar("account_type", { length: 40 }).notNull(),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_github_installation_id").on(table.installationId),
    uniqueIndex("uq_towbar_github_installations_workspace").on(
      table.workspaceId,
    ),
  ],
);

export const sources = pgTable(
  "towbar_sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    githubInstallationId: uuid("github_installation_id")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "restrict" }),
    repositoryOwner: varchar("repository_owner", { length: 255 }).notNull(),
    repositoryName: varchar("repository_name", { length: 255 }).notNull(),
    branch: varchar("branch", { length: 255 }).notNull(),
    status: sourceStatusEnum("status").default("active").notNull(),
    latestCommitSha: varchar("latest_commit_sha", { length: 64 }),
    latestManifestDigest: varchar("latest_manifest_digest", { length: 64 }),
    latestSuccessfulSyncId: uuid("latest_successful_sync_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_sources_repository_branch").on(
      table.workspaceId,
      table.repositoryOwner,
      table.repositoryName,
      table.branch,
    ),
    index("idx_towbar_sources_workspace").on(table.workspaceId),
  ],
);

export const sourceAwsCredentials = pgTable(
  "towbar_source_aws_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    encryptedPayload: jsonb("encrypted_payload")
      .$type<EncryptedCredential>()
      .notNull(),
    accessKeySuffix: varchar("access_key_suffix", { length: 8 }).notNull(),
    region: varchar("region", { length: 64 }).notNull(),
    verificationStatus: credentialVerificationStatusEnum("verification_status")
      .default("unverified")
      .notNull(),
    verificationMessage: varchar("verification_message", { length: 500 }),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_aws_credentials_source").on(table.sourceId),
    index("idx_towbar_aws_credentials_workspace").on(table.workspaceId),
  ],
);

export const sourceSyncs = pgTable(
  "towbar_source_syncs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    status: sourceSyncStatusEnum("status").default("queued").notNull(),
    commitSha: varchar("commit_sha", { length: 64 }),
    manifestDigest: varchar("manifest_digest", { length: 64 }),
    rawManifest: text("raw_manifest"),
    normalizedManifest: jsonb(
      "normalized_manifest",
    ).$type<NormalizedDeploymentManifest>(),
    reconciliation: jsonb("reconciliation").$type<ManifestReconciliation>(),
    issues: jsonb("issues").$type<ManifestIssue[]>(),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_towbar_source_syncs_source_created").on(
      table.sourceId,
      table.createdAt,
    ),
  ],
);

export const githubWebhookDeliveries = pgTable(
  "towbar_github_webhook_deliveries",
  {
    deliveryId: varchar("delivery_id", { length: 100 }).primaryKey(),
    eventName: varchar("event_name", { length: 100 }).notNull(),
    action: varchar("action", { length: 100 }),
    payloadDigest: varchar("payload_digest", { length: 64 }).notNull(),
    sourceId: uuid("source_id").references(() => sources.id, {
      onDelete: "set null",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (table) => [index("idx_towbar_webhooks_accepted_at").on(table.acceptedAt)],
);

export const servers = pgTable(
  "towbar_servers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    canonicalIp: varchar("canonical_ip", { length: 64 }).notNull(),
    config: jsonb("config").$type<NormalizedServer>().notNull(),
    configDigest: varchar("config_digest", { length: 64 }).notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    preparedConfigDigest: varchar("prepared_config_digest", { length: 64 }),
    sourceRevision: varchar("source_revision", { length: 64 }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_servers_source_ip").on(
      table.sourceId,
      table.canonicalIp,
    ),
    index("idx_towbar_servers_workspace").on(table.workspaceId),
    index("idx_towbar_servers_archived_at").on(table.archivedAt),
  ],
);

export const serverChecks = pgTable(
  "towbar_server_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    status: checkStatusEnum("status").default("queued").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: varchar("error_message", { length: 1_000 }),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_towbar_server_checks_server").on(table.serverId)],
);

export const serverPreparations = pgTable(
  "towbar_server_preparations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    configDigest: varchar("config_digest", { length: 64 }).notNull(),
    status: checkStatusEnum("status").default("queued").notNull(),
    steps: jsonb("steps").$type<ServerPreparationStep[]>().notNull(),
    result: jsonb("result").$type<Record<string, unknown>>(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: varchar("error_message", { length: 1_000 }),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_towbar_server_preparations_server_created").on(
      table.serverId,
      table.createdAt,
    ),
    uniqueIndex("uq_towbar_server_preparations_active")
      .on(table.serverId)
      .where(sql`${table.status} in ('queued', 'running')`),
  ],
);

export const sshHostKeys = pgTable(
  "towbar_ssh_host_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    algorithm: varchar("algorithm", { length: 80 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 255 }).notNull(),
    publicKey: text("public_key").notNull(),
    trustedBy: uuid("trusted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_ssh_host_keys_active").on(
      table.serverId,
      table.fingerprint,
    ),
  ],
);

export const apps = pgTable(
  "towbar_apps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "restrict" }),
    manifestId: varchar("manifest_id", { length: 63 }).notNull(),
    kind: deployableKindEnum("kind").default("app").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    description: varchar("description", { length: 500 }),
    config: jsonb("config").$type<NormalizedDeployable>().notNull(),
    configDigest: varchar("config_digest", { length: 64 }).notNull(),
    deploymentDigest: varchar("deployment_digest", { length: 64 }),
    sourceInputDigest: varchar("source_input_digest", { length: 64 }),
    sourceRevision: varchar("source_revision", { length: 64 }).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_apps_source_manifest_id").on(
      table.sourceId,
      table.manifestId,
    ),
    index("idx_towbar_apps_workspace").on(table.workspaceId),
    index("idx_towbar_apps_server").on(table.serverId),
    index("idx_towbar_apps_archived_at").on(table.archivedAt),
  ],
);

export const deployments = pgTable(
  "towbar_deployments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "restrict" }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "restrict" }),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    temporalWorkflowId: varchar("temporal_workflow_id", {
      length: 255,
    }).notNull(),
    kind: deploymentKindEnum("kind").default("deploy").notNull(),
    deployableKind: deployableKindEnum("deployable_kind")
      .default("app")
      .notNull(),
    state: deploymentStateEnum("state").default("queued").notNull(),
    commitSha: varchar("commit_sha", { length: 64 }).notNull(),
    configDigest: varchar("config_digest", { length: 64 }),
    deploymentDigest: varchar("deployment_digest", { length: 64 }),
    sourceInputDigest: varchar("source_input_digest", { length: 64 }),
    manifestDigest: varchar("manifest_digest", { length: 64 }).notNull(),
    appSnapshot: jsonb("app_snapshot").$type<NormalizedDeployable>().notNull(),
    serverSnapshot: jsonb("server_snapshot")
      .$type<NormalizedServer>()
      .notNull(),
    rollbackReleaseSnapshot: jsonb("rollback_release_snapshot").$type<{
      commitSha: string;
      containerName: string;
      imageTag: string;
      releaseId: string;
      sourceDeploymentId: string;
    }>(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: varchar("error_message", { length: 1_000 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "chk_towbar_deployments_rollback_snapshot",
      sql`(${table.kind} = 'deploy' AND ${table.rollbackReleaseSnapshot} IS NULL) OR (${table.kind} = 'rollback' AND ${table.rollbackReleaseSnapshot} IS NOT NULL)`,
    ),
    uniqueIndex("uq_towbar_deployments_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("uq_towbar_deployments_workflow_id").on(
      table.temporalWorkflowId,
    ),
    index("idx_towbar_deployments_app_created").on(
      table.appId,
      table.createdAt,
    ),
    index("idx_towbar_deployments_server_state").on(
      table.serverId,
      table.state,
    ),
  ],
);

export const deploymentSteps = pgTable(
  "towbar_deployment_steps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    state: deploymentStateEnum("state").notNull(),
    status: deploymentStepStatusEnum("status").default("waiting").notNull(),
    message: varchar("message", { length: 1_000 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_deployment_steps_sequence").on(
      table.deploymentId,
      table.sequence,
    ),
  ],
);

export const deploymentLogChunks = pgTable(
  "towbar_deployment_log_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    stream: varchar("stream", { length: 20 }).notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_deployment_logs_sequence").on(
      table.deploymentId,
      table.sequence,
    ),
    index("idx_towbar_deployment_logs_created").on(table.createdAt),
  ],
);

export const releases = pgTable(
  "towbar_releases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "restrict" }),
    status: releaseStatusEnum("status").notNull(),
    commitSha: varchar("commit_sha", { length: 64 }).notNull(),
    configDigest: varchar("config_digest", { length: 64 }),
    deploymentDigest: varchar("deployment_digest", { length: 64 }),
    sourceInputDigest: varchar("source_input_digest", { length: 64 }),
    imageTag: varchar("image_tag", { length: 512 }).notNull(),
    containerName: varchar("container_name", { length: 255 }).notNull(),
    promotedAt: timestamp("promoted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_towbar_releases_deployment").on(table.deploymentId),
    index("idx_towbar_releases_app_status").on(table.appId, table.status),
  ],
);

export const resourceOperations = pgTable(
  "towbar_resource_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").references(() => apps.id, {
      onDelete: "cascade",
    }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    temporalWorkflowId: varchar("temporal_workflow_id", {
      length: 255,
    }).notNull(),
    type: resourceOperationTypeEnum("type").notNull(),
    state: resourceOperationStateEnum("state").default("queued").notNull(),
    request: jsonb("request")
      .$type<PersistedResourceOperationRequest>()
      .notNull(),
    result: jsonb("result").$type<ResourceOperationResult>(),
    appSnapshot: jsonb("app_snapshot").$type<NormalizedDeployable>(),
    serverSnapshot: jsonb("server_snapshot")
      .$type<NormalizedServer>()
      .notNull(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: varchar("error_message", { length: 1_000 }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_resource_operations_idempotency").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    uniqueIndex("uq_towbar_resource_operations_workflow").on(
      table.temporalWorkflowId,
    ),
    index("idx_towbar_resource_operations_resource_created").on(
      table.resourceId,
      table.createdAt,
    ),
    index("idx_towbar_resource_operations_server_state").on(
      table.serverId,
      table.state,
    ),
  ],
);

export const deployableRuntimeStates = pgTable(
  "towbar_deployable_runtime_states",
  {
    appId: uuid("app_id")
      .primaryKey()
      .references(() => apps.id, { onDelete: "cascade" }),
    desiredState: runtimeDesiredStateEnum("desired_state")
      .default("running")
      .notNull(),
    observedState: runtimeObservedStateEnum("observed_state")
      .default("unknown")
      .notNull(),
    healthStatus: runtimeHealthStateEnum("health_status")
      .default("unknown")
      .notNull(),
    driftStatus: runtimeDriftStateEnum("drift_status")
      .default("unknown")
      .notNull(),
    driftReasons: jsonb("drift_reasons")
      .$type<string[]>()
      .notNull()
      .default([]),
    observedContainerName: varchar("observed_container_name", { length: 255 }),
    observedImage: varchar("observed_image", { length: 512 }),
    lastCheckId: uuid("last_check_id").references(() => serverChecks.id, {
      onDelete: "set null",
    }),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_towbar_runtime_drift").on(table.driftStatus)],
);

export const requestNonces = pgTable(
  "towbar_request_nonces",
  {
    scope: varchar("scope", { length: 160 }).notNull(),
    nonce: varchar("nonce", { length: 160 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.scope, table.nonce],
      name: "pk_towbar_request_nonces",
    }),
    index("idx_towbar_request_nonces_expires").on(table.expiresAt),
  ],
);

export const auditEvents = pgTable(
  "towbar_audit_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 160 }).notNull(),
    targetType: varchar("target_type", { length: 80 }).notNull(),
    targetId: varchar("target_id", { length: 255 }),
    requestId: varchar("request_id", { length: 100 }),
    metadata: jsonb("metadata")
      .$type<Record<string, boolean | number | string | null>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_towbar_audit_workspace_created").on(
      table.workspaceId,
      table.createdAt,
    ),
  ],
);
