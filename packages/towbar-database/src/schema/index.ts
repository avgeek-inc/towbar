import {
  boolean,
  check,
  foreignKey,
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
import { deploymentEnvironments } from "@workspace/towbar-core/preview";

import type {
  DeferredAutomaticDeployment,
  NotificationCategory,
  NotificationDestinationInput,
  NotificationEventPayload,
  NotificationEventType,
  PersistedResourceOperationRequest,
  ResourceOperationResult,
  EncryptedCredential,
  ManifestIssue,
  ManifestReconciliation,
  NormalizedDeployable,
  NormalizedDeploymentManifest,
  NormalizedServer,
  BackupAssuranceCheck,
  BackupAssuranceStatus,
  RestoreOperationPhase,
  ServerPreparationStep,
  VulnerabilitySeverityTotals,
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
export type CheckStatus = (typeof checkStatusEnum.enumValues)[number];
export const credentialVerificationStatusEnum = pgEnum(
  "towbar_credential_verification_status",
  ["unverified", "verified", "failed"],
);
export const deploymentStateEnum = pgEnum(
  "towbar_deployment_state",
  deploymentStates,
);
export const deploymentEnvironmentEnum = pgEnum(
  "towbar_deployment_environment",
  deploymentEnvironments,
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
export const previewEnvironmentStatusEnum = pgEnum(
  "towbar_preview_environment_status",
  ["building", "healthy", "failed", "deleting", "cleanup_failed", "deleted"],
);
export const previewReportDeliveryStatusEnum = pgEnum(
  "towbar_preview_report_delivery_status",
  ["pending", "published", "failed"],
);
export const resourceOperationTypeEnum = pgEnum(
  "towbar_resource_operation_type",
  [
    "backup",
    "capture_logs",
    "cleanup_orphans",
    "restart",
    "restore",
    "restore_cleanup",
    "start",
    "stop",
  ],
);
export const resourceOperationStateEnum = pgEnum(
  "towbar_resource_operation_state",
  ["queued", "running", "succeeded", "failed", "cancelled"],
);
export const backupAssuranceStatusEnum = pgEnum(
  "towbar_backup_assurance_status",
  ["missing", "stale", "not_restore_ready", "restore_ready"],
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
export const notificationProviderEnum = pgEnum("towbar_notification_provider", [
  "slack",
  "smtp",
]);
export const notificationDeliveryStateEnum = pgEnum(
  "towbar_notification_delivery_state",
  ["pending", "delivering", "retrying", "succeeded", "failed"],
);
export const notificationAttemptStateEnum = pgEnum(
  "towbar_notification_attempt_state",
  ["running", "succeeded", "retryable_failure", "terminal_failure"],
);
export const vulnerabilityScanStateEnum = pgEnum(
  "towbar_vulnerability_scan_state",
  ["pending", "running", "clean", "findings", "failed"],
);
export const vulnerabilitySeverityEnum = pgEnum(
  "towbar_vulnerability_severity",
  ["critical", "high", "medium", "low", "unknown"],
);
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
  operatorResetFingerprint: varchar("operator_reset_fingerprint", {
    length: 64,
  }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const authRateLimitBuckets = pgTable(
  "towbar_auth_rate_limit_buckets",
  {
    keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("idx_towbar_auth_rate_limit_expires").on(table.expiresAt)],
);

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
    autoDeployPaused: boolean("auto_deploy_paused").default(false).notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_sources_secret_owner").on(
      table.id,
      table.workspaceId,
    ),
    uniqueIndex("uq_towbar_sources_repository_branch").on(
      table.workspaceId,
      table.repositoryOwner,
      table.repositoryName,
      table.branch,
    ),
    index("idx_towbar_sources_workspace").on(table.workspaceId),
  ],
);

export const workspaceAwsCredentials = pgTable(
  "towbar_workspace_aws_credentials",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
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
    uniqueIndex("uq_towbar_aws_credentials_workspace").on(table.workspaceId),
  ],
);

export const notificationDestinations = pgTable(
  "towbar_notification_destinations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    provider: notificationProviderEnum("provider").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    categories: jsonb("categories").$type<NotificationCategory[]>().notNull(),
    config: jsonb("config")
      .$type<NotificationDestinationInput["config"]>()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_towbar_notification_destinations_source").on(table.sourceId),
  ],
);

export const notificationEvents = pgTable(
  "towbar_notification_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    dedupeKey: varchar("dedupe_key", { length: 512 }).notNull(),
    type: varchar("type", { length: 80 })
      .$type<NotificationEventType>()
      .notNull(),
    category: varchar("category", { length: 40 })
      .$type<NotificationCategory | "test">()
      .notNull(),
    payload: jsonb("payload").$type<NotificationEventPayload>().notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_notification_events_dedupe").on(
      table.sourceId,
      table.dedupeKey,
    ),
    index("idx_towbar_notification_events_source_created").on(
      table.sourceId,
      table.createdAt,
    ),
  ],
);

export const notificationDeliveries = pgTable(
  "towbar_notification_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => notificationEvents.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => notificationDestinations.id, { onDelete: "cascade" }),
    state: notificationDeliveryStateEnum("state").default("pending").notNull(),
    cycle: integer("cycle").default(1).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    lastErrorCode: varchar("last_error_code", { length: 100 }),
    lastErrorMessage: varchar("last_error_message", { length: 1_000 }),
    lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_notification_deliveries_event_destination").on(
      table.eventId,
      table.destinationId,
    ),
    index("idx_towbar_notification_deliveries_state_next").on(
      table.state,
      table.nextAttemptAt,
    ),
    index("idx_towbar_notification_deliveries_destination_created").on(
      table.destinationId,
      table.createdAt,
    ),
  ],
);

export const notificationDeliveryAttempts = pgTable(
  "towbar_notification_delivery_attempts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    deliveryId: uuid("delivery_id")
      .notNull()
      .references(() => notificationDeliveries.id, { onDelete: "cascade" }),
    cycle: integer("cycle").notNull(),
    sequence: integer("sequence").notNull(),
    state: notificationAttemptStateEnum("state").default("running").notNull(),
    providerStatus: varchar("provider_status", { length: 100 }),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: varchar("error_message", { length: 1_000 }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("uq_towbar_notification_attempts_identity").on(
      table.deliveryId,
      table.cycle,
      table.sequence,
    ),
    index("idx_towbar_notification_attempts_delivery").on(table.deliveryId),
  ],
);

export const notificationThreads = pgTable(
  "towbar_notification_threads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => notificationDestinations.id, { onDelete: "cascade" }),
    entityKind: varchar("entity_kind", { length: 40 }).notNull(),
    entityId: varchar("entity_id", { length: 255 }).notNull(),
    creatingDeliveryId: uuid("creating_delivery_id").references(
      () => notificationDeliveries.id,
      { onDelete: "set null" },
    ),
    providerThreadId: varchar("provider_thread_id", { length: 100 }),
    providerMessageId: varchar("provider_message_id", { length: 100 }),
    latestEventAt: timestamp("latest_event_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_notification_threads_destination_entity").on(
      table.destinationId,
      table.entityKind,
      table.entityId,
    ),
    index("idx_towbar_notification_threads_destination").on(
      table.destinationId,
    ),
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
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    canonicalIp: varchar("canonical_ip", { length: 64 }).notNull(),
    config: jsonb("config").$type<NormalizedServer>().notNull(),
    configDigest: varchar("config_digest", { length: 64 }).notNull(),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    preparedConfigDigest: varchar("prepared_config_digest", { length: 64 }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_servers_secret_owner").on(
      table.id,
      table.workspaceId,
    ),
    uniqueIndex("uq_towbar_servers_workspace_ip").on(
      table.workspaceId,
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
  (table) => [
    index("idx_towbar_server_checks_server").on(
      table.serverId,
      table.createdAt,
      table.id,
    ),
  ],
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
    autoDeployPaused: boolean("auto_deploy_paused").default(false).notNull(),
    deferredAutomaticDeployment: jsonb(
      "deferred_automatic_deployment",
    ).$type<DeferredAutomaticDeployment>(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_apps_secret_owner").on(
      table.id,
      table.workspaceId,
      table.sourceId,
    ),
    uniqueIndex("uq_towbar_apps_source_manifest_id").on(
      table.sourceId,
      table.manifestId,
    ),
    index("idx_towbar_apps_workspace").on(table.workspaceId),
    index("idx_towbar_apps_server").on(table.serverId),
    index("idx_towbar_apps_archived_at").on(table.archivedAt),
  ],
);

export const previewEnvironments = pgTable(
  "towbar_preview_environments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    serverId: uuid("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "restrict" }),
    pullRequestNumber: integer("pull_request_number").notNull(),
    branch: varchar("branch", { length: 255 }).notNull(),
    gitRef: varchar("git_ref", { length: 512 }).notNull(),
    hostname: varchar("hostname", { length: 253 }).notNull(),
    runtimeId: varchar("runtime_id", { length: 255 }).notNull(),
    latestCommitSha: varchar("latest_commit_sha", { length: 64 }).notNull(),
    latestDeploymentId: uuid("latest_deployment_id"),
    status: previewEnvironmentStatusEnum("status")
      .default("building")
      .notNull(),
    errorMessage: varchar("error_message", { length: 1_000 }),
    cleanupAttempts: integer("cleanup_attempts").default(0).notNull(),
    lastCleanupAttemptAt: timestamp("last_cleanup_attempt_at", {
      withTimezone: true,
    }),
    nextCleanupAttemptAt: timestamp("next_cleanup_attempt_at", {
      withTimezone: true,
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_preview_environment_ref").on(
      table.sourceId,
      table.appId,
      table.gitRef,
    ),
    uniqueIndex("uq_towbar_preview_environment_hostname").on(table.hostname),
    index("idx_towbar_preview_environment_source_status").on(
      table.sourceId,
      table.status,
    ),
    index("idx_towbar_preview_environment_expires").on(
      table.status,
      table.expiresAt,
    ),
  ],
);

export const previewPullRequestReports = pgTable(
  "towbar_preview_pull_request_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    pullRequestNumber: integer("pull_request_number").notNull(),
    branch: varchar("branch", { length: 255 }).notNull(),
    latestCommitSha: varchar("latest_commit_sha", { length: 64 }).notNull(),
    skippedApps: jsonb("skipped_apps")
      .$type<Array<{ appId: string; appName: string; reason: string }>>()
      .default([])
      .notNull(),
    commentDeliveryStatus: previewReportDeliveryStatusEnum(
      "comment_delivery_status",
    )
      .default("pending")
      .notNull(),
    commentDeliveryError: varchar("comment_delivery_error", { length: 1_000 }),
    commentLastAttemptedAt: timestamp("comment_last_attempted_at", {
      withTimezone: true,
    }),
    commentPublishedAt: timestamp("comment_published_at", {
      withTimezone: true,
    }),
    deploymentDeliveryStatus: previewReportDeliveryStatusEnum(
      "deployment_delivery_status",
    )
      .default("pending")
      .notNull(),
    deploymentDeliveryError: varchar("deployment_delivery_error", {
      length: 1_000,
    }),
    deploymentLastAttemptedAt: timestamp("deployment_last_attempted_at", {
      withTimezone: true,
    }),
    deploymentPublishedAt: timestamp("deployment_published_at", {
      withTimezone: true,
    }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_preview_report_source_pr").on(
      table.sourceId,
      table.pullRequestNumber,
    ),
    index("idx_towbar_preview_report_workspace_comment").on(
      table.workspaceId,
      table.commentDeliveryStatus,
    ),
    index("idx_towbar_preview_report_workspace_deployment").on(
      table.workspaceId,
      table.deploymentDeliveryStatus,
    ),
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
    secretRevisions:
      jsonb("secret_revisions").$type<Record<string, string | null>>(),
    environment: deploymentEnvironmentEnum("environment")
      .default("production")
      .notNull(),
    gitRef: varchar("git_ref", { length: 512 }),
    hostname: varchar("hostname", { length: 253 }),
    githubDeploymentId: varchar("github_deployment_id", { length: 40 }),
    previewEnvironmentId: uuid("preview_environment_id").references(
      () => previewEnvironments.id,
      { onDelete: "restrict" },
    ),
    deployableKind: deployableKindEnum("deployable_kind")
      .default("app")
      .notNull(),
    state: deploymentStateEnum("state").default("queued").notNull(),
    commitSha: varchar("commit_sha", { length: 64 }).notNull(),
    configDigest: varchar("config_digest", { length: 64 }),
    deploymentDigest: varchar("deployment_digest", { length: 64 }),
    sourceInputDigest: varchar("source_input_digest", { length: 64 }),
    manifestDigest: varchar("manifest_digest", { length: 64 }).notNull(),
    imageDigest: varchar("image_digest", { length: 71 }),
    imagePlatform: varchar("image_platform", { length: 64 }),
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
    check(
      "chk_towbar_deployments_environment",
      sql`(${table.environment} = 'production' AND ${table.previewEnvironmentId} IS NULL AND ${table.gitRef} IS NULL AND ${table.hostname} IS NULL) OR (${table.environment} = 'preview' AND ${table.previewEnvironmentId} IS NOT NULL AND ${table.gitRef} IS NOT NULL AND ${table.hostname} IS NOT NULL)`,
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
    index("idx_towbar_deployments_preview_created").on(
      table.previewEnvironmentId,
      table.createdAt,
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

export const imageVulnerabilityScans = pgTable(
  "towbar_image_vulnerability_scans",
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
    deploymentId: uuid("deployment_id")
      .notNull()
      .references(() => deployments.id, { onDelete: "restrict" }),
    imageDigest: varchar("image_digest", { length: 71 }).notNull(),
    state: vulnerabilityScanStateEnum("state").default("pending").notNull(),
    cycle: integer("cycle").default(1).notNull(),
    scannerName: varchar("scanner_name", { length: 100 }),
    scannerVersion: varchar("scanner_version", { length: 100 }),
    vulnerabilityDatabaseUpdatedAt: timestamp(
      "vulnerability_database_updated_at",
      { withTimezone: true },
    ),
    severityTotals: jsonb("severity_totals")
      .$type<VulnerabilitySeverityTotals>()
      .notNull(),
    findingsTruncated: boolean("findings_truncated").default(false).notNull(),
    errorCode: varchar("error_code", { length: 100 }),
    errorMessage: varchar("error_message", { length: 1_000 }),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_vulnerability_scans_workspace_digest").on(
      table.workspaceId,
      table.imageDigest,
    ),
    index("idx_towbar_vulnerability_scans_state_requested").on(
      table.state,
      table.requestedAt,
    ),
    index("idx_towbar_vulnerability_scans_deployment").on(table.deploymentId),
  ],
);

export const imageVulnerabilityFindings = pgTable(
  "towbar_image_vulnerability_findings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scanId: uuid("scan_id")
      .notNull()
      .references(() => imageVulnerabilityScans.id, { onDelete: "cascade" }),
    advisoryId: varchar("advisory_id", { length: 160 }).notNull(),
    severity: vulnerabilitySeverityEnum("severity").notNull(),
    packageName: varchar("package_name", { length: 255 }).notNull(),
    installedVersion: varchar("installed_version", { length: 255 }).notNull(),
    fixedVersion: varchar("fixed_version", { length: 255 }),
    target: varchar("target", { length: 512 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_towbar_vulnerability_findings_scan_severity").on(
      table.scanId,
      table.severity,
    ),
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
    environment: deploymentEnvironmentEnum("environment")
      .default("production")
      .notNull(),
    gitRef: varchar("git_ref", { length: 512 }),
    previewEnvironmentId: uuid("preview_environment_id").references(
      () => previewEnvironments.id,
      { onDelete: "restrict" },
    ),
    status: releaseStatusEnum("status").notNull(),
    commitSha: varchar("commit_sha", { length: 64 }).notNull(),
    configDigest: varchar("config_digest", { length: 64 }),
    deploymentDigest: varchar("deployment_digest", { length: 64 }),
    sourceInputDigest: varchar("source_input_digest", { length: 64 }),
    imageDigest: varchar("image_digest", { length: 71 }),
    imagePlatform: varchar("image_platform", { length: 64 }),
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
    index("idx_towbar_releases_preview_status").on(
      table.previewEnvironmentId,
      table.status,
    ),
    check(
      "chk_towbar_releases_environment",
      sql`(${table.environment} = 'production' AND ${table.previewEnvironmentId} IS NULL AND ${table.gitRef} IS NULL) OR (${table.environment} = 'preview' AND ${table.previewEnvironmentId} IS NOT NULL AND ${table.gitRef} IS NOT NULL)`,
    ),
  ],
);

export const resourceOperations = pgTable(
  "towbar_resource_operations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, {
      onDelete: "cascade",
    }),
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
    phase: varchar("phase", { length: 64 }).$type<RestoreOperationPhase>(),
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
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
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
    check(
      "chk_towbar_resource_operations_owner",
      sql`(${table.type} = 'cleanup_orphans' AND ${table.sourceId} IS NULL AND ${table.resourceId} IS NULL) OR (${table.type} <> 'cleanup_orphans' AND ${table.sourceId} IS NOT NULL AND ${table.resourceId} IS NOT NULL)`,
    ),
  ],
);

export const resourceOperationEvents = pgTable(
  "towbar_resource_operation_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => resourceOperations.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    phase: varchar("phase", { length: 64 })
      .$type<RestoreOperationPhase>()
      .notNull(),
    level: varchar("level", { length: 16 })
      .$type<"error" | "info" | "success">()
      .default("info")
      .notNull(),
    message: varchar("message", { length: 1_000 }).notNull(),
    command: varchar("command", { length: 1_000 }),
    metadata: jsonb("metadata")
      .$type<Record<string, boolean | number | string | null>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("uq_towbar_resource_operation_events_sequence").on(
      table.operationId,
      table.sequence,
    ),
    index("idx_towbar_resource_operation_events_created").on(
      table.operationId,
      table.createdAt,
    ),
  ],
);

export const resourceBackupAssurances = pgTable(
  "towbar_resource_backup_assurances",
  {
    resourceId: uuid("resource_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    backupOperationId: uuid("backup_operation_id")
      .primaryKey()
      .references(() => resourceOperations.id, { onDelete: "cascade" }),
    status: backupAssuranceStatusEnum("status").notNull(),
    restoreReady: boolean("restore_ready").default(false).notNull(),
    checks: jsonb("checks")
      .$type<BackupAssuranceCheck[]>()
      .notNull()
      .default([]),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_towbar_backup_assurances_resource").on(table.resourceId),
    index("idx_towbar_backup_assurances_status").on(table.status),
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

export const systemHealthSignals = pgTable(
  "towbar_system_health_signals",
  {
    key: varchar("key", { length: 255 }).primaryKey(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, {
      onDelete: "cascade",
    }),
    component: varchar("component", { length: 80 }).notNull(),
    status: varchar("status", { length: 32 }).notNull(),
    message: varchar("message", { length: 500 }).notNull(),
    version: varchar("version", { length: 64 }),
    details: jsonb("details")
      .$type<Record<string, boolean | number | string | null>>()
      .notNull()
      .default({}),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("idx_towbar_system_health_workspace").on(
      table.workspaceId,
      table.component,
    ),
  ],
);

// Secret configuration is independent of manifest snapshots. Foreign keys retain
// credentials on archive and remove them only when their owner is deleted.
export const managedSecrets = pgTable(
  "towbar_managed_secrets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, {
      onDelete: "cascade",
    }),
    appId: uuid("app_id").references(() => apps.id, { onDelete: "cascade" }),
    serverId: uuid("server_id").references(() => servers.id, {
      onDelete: "cascade",
    }),
    owner: text("owner").notNull(),
    environment: deploymentEnvironmentEnum("environment")
      .notNull()
      .default("production"),
    stage: text("stage").notNull(),
    encryptedPayload: jsonb("encrypted_payload")
      .$type<EncryptedCredential>()
      .notNull(),
    keys: jsonb("keys").$type<string[]>().notNull(),
    revision: uuid("revision").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "fk_towbar_secret_sources_owner",
      columns: [table.sourceId, table.workspaceId],
      foreignColumns: [sources.id, sources.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_towbar_secret_apps_owner",
      columns: [table.appId, table.workspaceId, table.sourceId],
      foreignColumns: [apps.id, apps.workspaceId, apps.sourceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_towbar_secret_servers_owner",
      columns: [table.serverId, table.workspaceId],
      foreignColumns: [servers.id, servers.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("uq_towbar_managed_secret_slot").on(
      table.workspaceId,
      table.owner,
      table.environment,
      table.stage,
    ),
    check(
      "towbar_managed_secret_owner",
      sql`(
    (${table.owner} = 'workspace:' || ${table.workspaceId}::text AND ${table.sourceId} IS NULL AND ${table.appId} IS NULL AND ${table.serverId} IS NULL)
    OR (${table.owner} = 'source:' || ${table.sourceId}::text AND ${table.sourceId} IS NOT NULL AND ${table.appId} IS NULL AND ${table.serverId} IS NULL)
    OR (${table.owner} = 'app:' || ${table.appId}::text AND ${table.appId} IS NOT NULL AND ${table.sourceId} IS NOT NULL AND ${table.serverId} IS NULL)
    OR (${table.owner} = 'server:' || ${table.serverId}::text AND ${table.serverId} IS NOT NULL AND ${table.sourceId} IS NULL AND ${table.appId} IS NULL)
  ) IS TRUE`,
    ),
    check(
      "towbar_managed_secret_stage",
      sql`(
    (${table.stage} IN ('build', 'deployment', 'pre_deploy', 'post_deploy') AND (${table.owner} = 'workspace:' || ${table.workspaceId}::text OR ${table.appId} IS NOT NULL OR (${table.sourceId} IS NOT NULL AND ${table.serverId} IS NULL)))
    OR (${table.stage} = 'credentials' AND ${table.serverId} IS NOT NULL AND ${table.environment} = 'production')
  )`,
    ),
  ],
);
