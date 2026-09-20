CREATE TYPE "public"."towbar_backup_assurance_status" AS ENUM('missing', 'stale', 'not_restore_ready', 'restore_ready');--> statement-breakpoint
CREATE TYPE "public"."towbar_check_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_credential_verification_status" AS ENUM('unverified', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployable_kind" AS ENUM('app', 'compose', 'image', 'postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'dragonfly', 'keydb', 'clickhouse');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_environment" AS ENUM('production', 'preview');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_kind" AS ENUM('deploy', 'rollback');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_state" AS ENUM('queued', 'waiting_for_server', 'preparing', 'validating_credentials', 'checking_server', 'fetching_source', 'resolving_secrets', 'transferring', 'building', 'running_pre_deploy', 'starting_candidate', 'checking_health', 'configuring_routing', 'provisioning_tls', 'checking_public_endpoint', 'switching_traffic', 'running_post_deploy', 'cleaning_up', 'succeeded', 'succeeded_with_warnings', 'skipped', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_step_status" AS ENUM('waiting', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."towbar_notification_attempt_state" AS ENUM('running', 'succeeded', 'retryable_failure', 'terminal_failure');--> statement-breakpoint
CREATE TYPE "public"."towbar_notification_delivery_state" AS ENUM('pending', 'delivering', 'retrying', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_notification_provider" AS ENUM('slack', 'smtp', 'discord', 'telegram', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."towbar_preview_environment_status" AS ENUM('building', 'healthy', 'failed', 'deleting', 'cleanup_failed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."towbar_preview_report_delivery_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_release_status" AS ENUM('current', 'previous', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."towbar_resource_operation_state" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."towbar_resource_operation_type" AS ENUM('backup', 'capture_logs', 'run_job', 'cleanup_orphans', 'restart', 'restore', 'restore_cleanup', 'start', 'stop');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_desired_state" AS ENUM('running', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_drift_state" AS ENUM('drifted', 'in_sync', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_health_state" AS ENUM('healthy', 'none', 'starting', 'unhealthy', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_observed_state" AS ENUM('missing', 'running', 'stopped', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."towbar_source_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."towbar_source_sync_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_vulnerability_scan_state" AS ENUM('pending', 'running', 'clean', 'findings', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_vulnerability_severity" AS ENUM('critical', 'high', 'medium', 'low', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."towbar_workspace_role" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "towbar_api_key_policies" (
	"key_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"owner_user_id" uuid,
	"creator_user_id" uuid,
	"access" text NOT NULL,
	"include_admin" boolean DEFAULT false NOT NULL,
	"grants" jsonb NOT NULL,
	"creation_request_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"creation_digest" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_api_policy_scope" CHECK (("towbar_api_key_policies"."scope" = 'personal' and "towbar_api_key_policies"."owner_user_id" is not null) or ("towbar_api_key_policies"."scope" = 'team' and "towbar_api_key_policies"."owner_user_id" is null)),
	CONSTRAINT "towbar_api_policy_access" CHECK ("towbar_api_key_policies"."access" in ('read', 'edit')),
	CONSTRAINT "towbar_api_policy_admin" CHECK (not "towbar_api_key_policies"."include_admin" or "towbar_api_key_policies"."access" = 'edit')
);
--> statement-breakpoint
CREATE TABLE "towbar_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"config_id" text NOT NULL,
	"name" text,
	"start" text,
	"reference_id" uuid NOT NULL,
	"prefix" text,
	"key" text NOT NULL,
	"refill_interval" integer,
	"refill_amount" integer,
	"last_refill_at" timestamp with time zone,
	"enabled" boolean DEFAULT true,
	"rate_limit_enabled" boolean DEFAULT true,
	"rate_limit_time_window" integer DEFAULT 60000,
	"rate_limit_max" integer DEFAULT 60,
	"request_count" integer DEFAULT 0,
	"remaining" integer,
	"last_request" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"permissions" text,
	"metadata" text,
	CONSTRAINT "towbar_api_keys_config" CHECK ("towbar_api_keys"."config_id" in ('personal', 'team'))
);
--> statement-breakpoint
CREATE TABLE "towbar_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"source_environment_id" uuid NOT NULL,
	"required_secrets" jsonb NOT NULL,
	"manifest_id" varchar(63) NOT NULL,
	"kind" "towbar_deployable_kind" DEFAULT 'app' NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"config" jsonb NOT NULL,
	"config_digest" varchar(64) NOT NULL,
	"deployment_digest" varchar(64),
	"source_input_digest" varchar(64),
	"source_revision" varchar(64) NOT NULL,
	"auto_deploy_paused" boolean DEFAULT false NOT NULL,
	"deferred_automatic_deployment" jsonb,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_towbar_apps_secret_owner" UNIQUE("id","workspace_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_kind" text,
	"actor_key_id" uuid,
	"actor_user_id" uuid,
	"action" varchar(160) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" varchar(255),
	"request_id" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_auth_passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar(120),
	"public_key" text NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_auth_rate_limit_buckets" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_auth_two_factors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"failed_verification_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "towbar_auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_deployable_runtime_states" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"desired_state" "towbar_runtime_desired_state" DEFAULT 'running' NOT NULL,
	"observed_state" "towbar_runtime_observed_state" DEFAULT 'unknown' NOT NULL,
	"health_status" "towbar_runtime_health_state" DEFAULT 'unknown' NOT NULL,
	"drift_status" "towbar_runtime_drift_state" DEFAULT 'unknown' NOT NULL,
	"drift_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_container_name" varchar(255),
	"observed_image" varchar(512),
	"ingress_status" varchar(32) DEFAULT 'unknown' NOT NULL,
	"ingress_container_name" varchar(255),
	"ingress_image" varchar(512),
	"ingress_restart_count" integer,
	"last_check_id" uuid,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_deployment_log_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"stream" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_deployment_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deployment_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"state" "towbar_deployment_state" NOT NULL,
	"status" "towbar_deployment_step_status" DEFAULT 'waiting' NOT NULL,
	"message" varchar(1000),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_deployments" (
	"target_environment" jsonb NOT NULL,
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"build_server_id" uuid,
	"requested_by_key_id" uuid,
	"requested_by_actor" jsonb,
	"requested_by" uuid,
	"idempotency_key" varchar(255) NOT NULL,
	"temporal_workflow_id" varchar(255) NOT NULL,
	"kind" "towbar_deployment_kind" DEFAULT 'deploy' NOT NULL,
	"secret_revisions" jsonb,
	"environment" "towbar_deployment_environment" DEFAULT 'production' NOT NULL,
	"git_ref" varchar(512),
	"hostname" varchar(253),
	"github_deployment_id" varchar(40),
	"preview_environment_id" uuid,
	"deployable_kind" "towbar_deployable_kind" DEFAULT 'app' NOT NULL,
	"state" "towbar_deployment_state" DEFAULT 'queued' NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"config_digest" varchar(64),
	"deployment_digest" varchar(64),
	"source_input_digest" varchar(64),
	"manifest_digest" varchar(64) NOT NULL,
	"image_digest" varchar(71),
	"image_source_reference" varchar(512),
	"image_platform" varchar(64),
	"required_secrets" jsonb NOT NULL,
	"app_snapshot" jsonb NOT NULL,
	"server_snapshot" jsonb NOT NULL,
	"build_server_snapshot" jsonb,
	"rollback_release_snapshot" jsonb,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_towbar_deployments_rollback_snapshot" CHECK (("towbar_deployments"."kind" = 'deploy' AND "towbar_deployments"."rollback_release_snapshot" IS NULL) OR ("towbar_deployments"."kind" = 'rollback' AND "towbar_deployments"."rollback_release_snapshot" IS NOT NULL)),
	CONSTRAINT "chk_towbar_deployments_environment" CHECK (("towbar_deployments"."environment" = 'production' AND "towbar_deployments"."preview_environment_id" IS NULL AND "towbar_deployments"."git_ref" IS NULL AND "towbar_deployments"."hostname" IS NULL) OR ("towbar_deployments"."environment" = 'preview' AND "towbar_deployments"."preview_environment_id" IS NOT NULL AND "towbar_deployments"."git_ref" IS NOT NULL AND "towbar_deployments"."hostname" IS NOT NULL)),
	CONSTRAINT "chk_towbar_deployments_build_server_snapshot" CHECK (("towbar_deployments"."build_server_id" IS NULL AND "towbar_deployments"."build_server_snapshot" IS NULL) OR ("towbar_deployments"."build_server_id" IS NOT NULL AND "towbar_deployments"."build_server_snapshot" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "towbar_email_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"previous_email" varchar(320) NOT NULL,
	"new_email" varchar(320) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_image_vulnerability_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"advisory_id" varchar(160) NOT NULL,
	"severity" "towbar_vulnerability_severity" NOT NULL,
	"package_name" varchar(255) NOT NULL,
	"installed_version" varchar(255) NOT NULL,
	"fixed_version" varchar(255),
	"target" varchar(512) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_image_vulnerability_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"image_digest" varchar(71) NOT NULL,
	"state" "towbar_vulnerability_scan_state" DEFAULT 'pending' NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"scanner_name" varchar(100),
	"scanner_version" varchar(100),
	"vulnerability_database_updated_at" timestamp with time zone,
	"severity_totals" jsonb NOT NULL,
	"findings_truncated" boolean DEFAULT false NOT NULL,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_installation_setup" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"code_hash" text,
	"workspace_id" uuid,
	"break_glass_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_setup_singleton" CHECK ("towbar_installation_setup"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "towbar_integration_authorization_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"requested_by" uuid,
	"provider" varchar(64) NOT NULL,
	"state_digest" varchar(64) NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"redirect_uri" varchar(2048) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_integration_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"slug" varchar(64) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" varchar(500) DEFAULT '' NOT NULL,
	"provider" varchar(64) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"encrypted_payload" jsonb,
	"credential_hint" varchar(8),
	"verification_status" "towbar_credential_verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_message" varchar(500),
	"verified_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_integration_revision_positive" CHECK ("towbar_integration_authorizations"."revision" > 0),
	CONSTRAINT "towbar_integration_connection_state" CHECK (("towbar_integration_authorizations"."disconnected_at" IS NULL AND "towbar_integration_authorizations"."encrypted_payload" IS NOT NULL) OR ("towbar_integration_authorizations"."disconnected_at" IS NOT NULL AND "towbar_integration_authorizations"."encrypted_payload" IS NULL)),
	CONSTRAINT "towbar_integration_slug" CHECK ("towbar_integration_authorizations"."slug" ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "towbar_integration_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" varchar(64) NOT NULL,
	"external_id" varchar(128) NOT NULL,
	"principal_name" varchar(255) NOT NULL,
	"principal_type" varchar(40) NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_integration_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(64) NOT NULL,
	"authorization_id" uuid,
	"installation_id" uuid,
	"delivery_id" varchar(128) NOT NULL,
	"event_name" varchar(100) NOT NULL,
	"action" varchar(100),
	"payload_digest" varchar(64) NOT NULL,
	"source_id" uuid,
	"occurred_at" timestamp with time zone,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "towbar_integration_webhook_identity" CHECK (num_nonnulls("towbar_integration_webhook_deliveries"."authorization_id", "towbar_integration_webhook_deliveries"."installation_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "towbar_managed_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"app_id" uuid,
	"server_id" uuid,
	"owner" text NOT NULL,
	"environment" varchar(80) DEFAULT 'production' NOT NULL,
	"stage" text NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"keys" jsonb NOT NULL,
	"revision" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_managed_secret_owner" CHECK ((
    ("towbar_managed_secrets"."owner" = 'workspace:' || "towbar_managed_secrets"."workspace_id"::text AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'source:' || "towbar_managed_secrets"."source_id"::text AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'app:' || "towbar_managed_secrets"."app_id"::text AND "towbar_managed_secrets"."app_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'server:' || "towbar_managed_secrets"."server_id"::text AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL)
  ) IS TRUE),
	CONSTRAINT "towbar_managed_secret_stage" CHECK ((
    ("towbar_managed_secrets"."stage" IN ('build', 'deployment', 'pre_deploy', 'post_deploy') AND ("towbar_managed_secrets"."owner" = 'workspace:' || "towbar_managed_secrets"."workspace_id"::text OR "towbar_managed_secrets"."app_id" IS NOT NULL OR ("towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)))
    OR ("towbar_managed_secrets"."stage" = 'credentials' AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."environment" = 'production')
  ))
);
--> statement-breakpoint
CREATE TABLE "towbar_monitoring_agents" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 15 NOT NULL,
	"desired_state" varchar(20) DEFAULT 'disabled' NOT NULL,
	"status" varchar(20) DEFAULT 'disabled' NOT NULL,
	"generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64),
	"encrypted_token" jsonb,
	"removal_requested" boolean DEFAULT false NOT NULL,
	"removal_requested_by" uuid,
	"installed_version" varchar(64),
	"last_report_at" timestamp with time zone,
	"last_collected_at" timestamp with time zone,
	"diagnostics" jsonb,
	"error_message" text,
	"operation_started_at" timestamp with time zone,
	"requested_by_key_id" uuid,
	"requested_by_actor" jsonb,
	"requested_by" uuid,
	"ingest_window" timestamp with time zone,
	"ingest_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_monitoring_retention" CHECK ("towbar_monitoring_agents"."retention_days" in (7,15,30,60)),
	CONSTRAINT "towbar_monitoring_desired_state" CHECK ("towbar_monitoring_agents"."desired_state" in ('enabled','disabled')),
	CONSTRAINT "towbar_monitoring_status" CHECK ("towbar_monitoring_agents"."status" in ('disabled','queued','installing','waiting','online','uninstalling','failed'))
);
--> statement-breakpoint
CREATE TABLE "towbar_monitoring_batches" (
	"server_id" uuid NOT NULL,
	"sample_id" varchar(32) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_monitoring_batches_server_id_sample_id_pk" PRIMARY KEY("server_id","sample_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_monitoring_samples" (
	"server_id" uuid NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"resolution" integer DEFAULT 30 NOT NULL,
	"deployable_id" uuid,
	"deployment_id" uuid,
	"preview_id" uuid,
	"state" varchar(20),
	"health" varchar(20),
	"metrics" jsonb NOT NULL,
	CONSTRAINT "towbar_monitoring_samples_server_id_entity_id_bucket_at_resolution_pk" PRIMARY KEY("server_id","entity_id","bucket_at","resolution"),
	CONSTRAINT "towbar_monitoring_resolution" CHECK ("towbar_monitoring_samples"."resolution" in (30,60))
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"destination_key" varchar(64) NOT NULL,
	"provider" "towbar_notification_provider" NOT NULL,
	"state" "towbar_notification_delivery_state" DEFAULT 'pending' NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" varchar(100),
	"last_error_message" varchar(1000),
	"last_attempted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"sequence" integer NOT NULL,
	"state" "towbar_notification_attempt_state" DEFAULT 'running' NOT NULL,
	"provider_status" varchar(100),
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"server_id" uuid,
	"dedupe_key" varchar(512) NOT NULL,
	"type" varchar(80) NOT NULL,
	"category" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notificationEvents_scope" CHECK (num_nonnulls("towbar_notification_events"."source_id", "towbar_notification_events"."server_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_key" varchar(64) NOT NULL,
	"entity_kind" varchar(40) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"creating_delivery_id" uuid,
	"provider_thread_id" varchar(100),
	"provider_message_id" varchar(100),
	"latest_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_preview_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"pull_request_number" integer NOT NULL,
	"branch" varchar(255) NOT NULL,
	"git_ref" varchar(512) NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"runtime_id" varchar(255) NOT NULL,
	"latest_commit_sha" varchar(64) NOT NULL,
	"latest_deployment_id" uuid,
	"status" "towbar_preview_environment_status" DEFAULT 'building' NOT NULL,
	"error_message" varchar(1000),
	"cleanup_requested_by_actor" jsonb,
	"cleanup_started_at" timestamp with time zone,
	"cleanup_attempts" integer DEFAULT 0 NOT NULL,
	"last_cleanup_attempt_at" timestamp with time zone,
	"next_cleanup_attempt_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_preview_pull_request_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"pull_request_number" integer NOT NULL,
	"branch" varchar(255) NOT NULL,
	"latest_commit_sha" varchar(64) NOT NULL,
	"skipped_apps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment_delivery_status" "towbar_preview_report_delivery_status" DEFAULT 'pending' NOT NULL,
	"comment_delivery_error" varchar(1000),
	"comment_last_attempted_at" timestamp with time zone,
	"comment_published_at" timestamp with time zone,
	"deployment_delivery_status" "towbar_preview_report_delivery_status" DEFAULT 'pending' NOT NULL,
	"deployment_delivery_error" varchar(1000),
	"deployment_last_attempted_at" timestamp with time zone,
	"deployment_published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"environment" "towbar_deployment_environment" DEFAULT 'production' NOT NULL,
	"git_ref" varchar(512),
	"preview_environment_id" uuid,
	"status" "towbar_release_status" NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"config_digest" varchar(64),
	"deployment_digest" varchar(64),
	"source_input_digest" varchar(64),
	"image_digest" varchar(71),
	"image_platform" varchar(64),
	"image_tag" varchar(512) NOT NULL,
	"container_name" varchar(255) NOT NULL,
	"container_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"compose_services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "chk_towbar_releases_environment" CHECK (("towbar_releases"."environment" = 'production' AND "towbar_releases"."preview_environment_id" IS NULL AND "towbar_releases"."git_ref" IS NULL) OR ("towbar_releases"."environment" = 'preview' AND "towbar_releases"."preview_environment_id" IS NOT NULL AND "towbar_releases"."git_ref" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "towbar_repository_webhook_cursors" (
	"source_id" uuid NOT NULL,
	"event_key" varchar(512) NOT NULL,
	"delivery_id" varchar(128) NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_repository_webhook_cursors_source_id_event_key_pk" PRIMARY KEY("source_id","event_key")
);
--> statement-breakpoint
CREATE TABLE "towbar_request_nonces" (
	"scope" varchar(160) NOT NULL,
	"nonce" varchar(160) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_towbar_request_nonces" PRIMARY KEY("scope","nonce")
);
--> statement-breakpoint
CREATE TABLE "towbar_resource_backup_assurances" (
	"resource_id" uuid NOT NULL,
	"backup_operation_id" uuid PRIMARY KEY NOT NULL,
	"status" "towbar_backup_assurance_status" NOT NULL,
	"restore_ready" boolean DEFAULT false NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_resource_operation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"phase" varchar(64) NOT NULL,
	"level" varchar(16) DEFAULT 'info' NOT NULL,
	"message" varchar(1000) NOT NULL,
	"command" varchar(1000),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_resource_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"resource_id" uuid,
	"server_id" uuid NOT NULL,
	"requested_by_key_id" uuid,
	"requested_by_actor" jsonb,
	"requested_by" uuid,
	"idempotency_key" varchar(255) NOT NULL,
	"temporal_workflow_id" varchar(255) NOT NULL,
	"type" "towbar_resource_operation_type" NOT NULL,
	"state" "towbar_resource_operation_state" DEFAULT 'queued' NOT NULL,
	"phase" varchar(64),
	"request" jsonb NOT NULL,
	"result" jsonb,
	"app_snapshot" jsonb,
	"server_snapshot" jsonb NOT NULL,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_towbar_resource_operations_owner" CHECK (("towbar_resource_operations"."type" = 'cleanup_orphans' AND "towbar_resource_operations"."source_id" IS NULL AND "towbar_resource_operations"."resource_id" IS NULL) OR ("towbar_resource_operations"."type" <> 'cleanup_orphans' AND "towbar_resource_operations"."source_id" IS NOT NULL AND "towbar_resource_operations"."resource_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "towbar_scout_alert_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"deployable_id" uuid,
	"environment" varchar(20),
	"rule_revision" timestamp with time zone,
	"rule_name" varchar(100) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"condition" jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"condition_started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_reason" varchar(80),
	"last_value" jsonb,
	"last_notified_at" timestamp with time zone,
	"notification_sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_scout_alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"deployable_id" uuid,
	"name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity" varchar(20) DEFAULT 'warning' NOT NULL,
	"environment" varchar(20) DEFAULT 'production' NOT NULL,
	"condition" jsonb NOT NULL,
	"evaluation_state" varchar(20) DEFAULT 'unknown' NOT NULL,
	"evaluated_at" timestamp with time zone,
	"observed_value" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_scout_rule_environment" CHECK ("towbar_scout_alert_rules"."environment" in ('production','preview')),
	CONSTRAINT "towbar_scout_rule_severity" CHECK ("towbar_scout_alert_rules"."severity" in ('warning','critical'))
);
--> statement-breakpoint
CREATE TABLE "towbar_scout_http_checks" (
	"rule_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"rule_revision" timestamp with time zone NOT NULL,
	"state" varchar(20) DEFAULT 'pending' NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"reason" varchar(240),
	CONSTRAINT "towbar_scout_http_checks_rule_id_scheduled_at_pk" PRIMARY KEY("rule_id","scheduled_at"),
	CONSTRAINT "towbar_scout_http_state" CHECK ("towbar_scout_http_checks"."state" in ('pending','healthy','failed','blocked'))
);
--> statement-breakpoint
CREATE TABLE "towbar_server_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"status" "towbar_check_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"requested_by_key_id" uuid,
	"requested_by_actor" jsonb,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_server_credential_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"private_key_id" uuid,
	"status" "towbar_check_status" DEFAULT 'queued' NOT NULL,
	"encrypted_private_key" jsonb,
	"expected_credential_revision" uuid,
	"result" jsonb,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"requested_by_key_id" uuid,
	"requested_by_actor" jsonb,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_server_deployable_ownership" (
	"server_id" uuid NOT NULL,
	"deployable_id" uuid NOT NULL,
	CONSTRAINT "towbar_server_deployable_ownership_server_id_deployable_id_pk" PRIMARY KEY("server_id","deployable_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_server_integration_states" (
	"integration_kind" varchar(64) DEFAULT 'log-forwarding' NOT NULL,
	"health" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"removal_requested" boolean DEFAULT false NOT NULL,
	"requested_by_actor" jsonb,
	"server_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"applied_digest" varchar(64),
	"status" varchar(16) DEFAULT 'pending' NOT NULL,
	"error_message" varchar(500),
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	CONSTRAINT "towbar_server_integration_states_server_id_integration_kind_pk" PRIMARY KEY("server_id","integration_kind")
);
--> statement-breakpoint
CREATE TABLE "towbar_server_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"config_digest" varchar(64) NOT NULL,
	"status" "towbar_check_status" DEFAULT 'queued' NOT NULL,
	"steps" jsonb NOT NULL,
	"result" jsonb,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"requested_by_key_id" uuid,
	"requested_by_actor" jsonb,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"private_key_id" uuid,
	"canonical_ip" varchar(64) NOT NULL,
	"config" jsonb NOT NULL,
	"config_digest" varchar(64) NOT NULL,
	"prepared_at" timestamp with time zone,
	"prepared_config_digest" varchar(64),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_towbar_servers_secret_owner" UNIQUE("id","workspace_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"active_organization_id" uuid,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_source_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"manifest_id" varchar(63) NOT NULL,
	"resource_type" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_towbar_source_entities_owner" UNIQUE("id","source_id"),
	CONSTRAINT "towbar_source_entity_kind" CHECK (("towbar_source_entities"."entity_type" IN ('app','compose') AND "towbar_source_entities"."resource_type" IS NULL) OR ("towbar_source_entities"."entity_type" = 'resource' AND "towbar_source_entities"."resource_type" IN ('image','postgres','mysql','mariadb','mongodb','redis','dragonfly','keydb','clickhouse')))
);
--> statement-breakpoint
CREATE TABLE "towbar_source_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"name" varchar(63) NOT NULL,
	"branch" varchar(255) NOT NULL,
	"mapping_revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"previews_enabled" boolean DEFAULT false NOT NULL,
	"latest_commit_sha" varchar(64),
	"latest_manifest_digest" varchar(64),
	"latest_successful_sync_id" uuid,
	"auto_deploy_paused" boolean DEFAULT false NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_towbar_source_environments_owner" UNIQUE("id","source_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_source_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_environment_id" uuid,
	"mapping_revision" uuid,
	"deploy_after_sync" boolean DEFAULT false NOT NULL,
	"status" "towbar_source_sync_status" DEFAULT 'queued' NOT NULL,
	"commit_sha" varchar(64),
	"manifest_digest" varchar(64),
	"raw_manifest" text,
	"normalized_manifest" jsonb,
	"reconciliation" jsonb,
	"issues" jsonb,
	"requested_by_key_id" uuid,
	"requested_by_actor" jsonb,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"integration_installation_id" uuid,
	"integration_authorization_id" uuid,
	"provider" varchar(16) DEFAULT 'github' NOT NULL,
	"provider_repository_id" varchar(128),
	"repository_owner" varchar(255) NOT NULL,
	"repository_name" varchar(255) NOT NULL,
	"status" "towbar_source_status" DEFAULT 'active' NOT NULL,
	"auto_deploy_paused" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_towbar_sources_secret_owner" UNIQUE("id","workspace_id"),
	CONSTRAINT "towbar_source_provider_connection" CHECK (("towbar_sources"."provider" = 'github' AND "towbar_sources"."integration_installation_id" IS NOT NULL AND "towbar_sources"."integration_authorization_id" IS NULL) OR ("towbar_sources"."provider" = 'gitlab' AND "towbar_sources"."integration_installation_id" IS NULL AND "towbar_sources"."integration_authorization_id" IS NOT NULL AND "towbar_sources"."provider_repository_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "towbar_ssh_host_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"algorithm" varchar(80) NOT NULL,
	"fingerprint" varchar(255) NOT NULL,
	"public_key" text NOT NULL,
	"trusted_by" uuid,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_system_health_signals" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"component" varchar(80) NOT NULL,
	"status" varchar(32) NOT NULL,
	"message" varchar(500) NOT NULL,
	"version" varchar(64),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_transactional_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"recipient" varchar(320) NOT NULL,
	"template" varchar(80) NOT NULL,
	"template_version" integer DEFAULT 1 NOT NULL,
	"dedupe_key" text NOT NULL,
	"invitation_id" uuid,
	"encrypted_data" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"date_time_preferences" jsonb DEFAULT '{"dateFormat":"day-short-month-year","timeFormat":"24-hour","timeZone":"UTC"}'::jsonb NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"two_factor_enabled" boolean DEFAULT false NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_users_email_normalized" CHECK ("towbar_users"."email" = lower(trim("towbar_users"."email")))
);
--> statement-breakpoint
CREATE TABLE "towbar_workspace_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"role" "towbar_workspace_role" NOT NULL,
	"inviter_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_invitation_email_normalized" CHECK ("towbar_workspace_invitations"."email" = lower(trim("towbar_workspace_invitations"."email")))
);
--> statement-breakpoint
CREATE TABLE "towbar_workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "towbar_workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_workspace_private_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"algorithm" varchar(24) NOT NULL,
	"generated" boolean DEFAULT false NOT NULL,
	"public_key" text,
	"encrypted_private_key" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"logo" text,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_key_policies_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_key_policies_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_key_policies_owner_user_id_towbar_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_key_policies_creator_user_id_towbar_users_id_fk" FOREIGN KEY ("creator_user_id") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_entity_id_towbar_source_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."towbar_source_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_source_environment_id_towbar_source_environments_id_fk" FOREIGN KEY ("source_environment_id") REFERENCES "public"."towbar_source_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "fk_towbar_apps_environment_owner" FOREIGN KEY ("source_environment_id","source_id") REFERENCES "public"."towbar_source_environments"("id","source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "fk_towbar_apps_entity_owner" FOREIGN KEY ("entity_id","source_id") REFERENCES "public"."towbar_source_entities"("id","source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "fk_towbar_apps_source_owner" FOREIGN KEY ("source_id","workspace_id") REFERENCES "public"."towbar_sources"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "fk_towbar_apps_server_owner" FOREIGN KEY ("server_id","workspace_id") REFERENCES "public"."towbar_servers"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_audit_events" ADD CONSTRAINT "towbar_audit_events_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_audit_events" ADD CONSTRAINT "towbar_audit_events_actor_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("actor_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_audit_events" ADD CONSTRAINT "towbar_audit_events_actor_user_id_towbar_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_auth_accounts" ADD CONSTRAINT "towbar_auth_accounts_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_auth_passkeys" ADD CONSTRAINT "towbar_auth_passkeys_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_auth_two_factors" ADD CONSTRAINT "towbar_auth_two_factors_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployable_runtime_states" ADD CONSTRAINT "towbar_deployable_runtime_states_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployable_runtime_states" ADD CONSTRAINT "towbar_deployable_runtime_states_last_check_id_towbar_server_checks_id_fk" FOREIGN KEY ("last_check_id") REFERENCES "public"."towbar_server_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployment_log_chunks" ADD CONSTRAINT "towbar_deployment_log_chunks_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployment_steps" ADD CONSTRAINT "towbar_deployment_steps_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_build_server_id_towbar_servers_id_fk" FOREIGN KEY ("build_server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_requested_by_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("requested_by_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_preview_environment_id_towbar_preview_environments_id_fk" FOREIGN KEY ("preview_environment_id") REFERENCES "public"."towbar_preview_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_email_changes" ADD CONSTRAINT "towbar_email_changes_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_findings" ADD CONSTRAINT "towbar_image_vulnerability_findings_scan_id_towbar_image_vulnerability_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."towbar_image_vulnerability_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_installation_setup" ADD CONSTRAINT "towbar_installation_setup_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_installation_setup" ADD CONSTRAINT "towbar_installation_setup_break_glass_user_id_towbar_users_id_fk" FOREIGN KEY ("break_glass_user_id") REFERENCES "public"."towbar_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_integration_authorization_attempts" ADD CONSTRAINT "towbar_integration_authorization_attempts_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_integration_authorization_attempts" ADD CONSTRAINT "towbar_integration_authorization_attempts_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_integration_authorizations" ADD CONSTRAINT "towbar_integration_authorizations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_integration_installations" ADD CONSTRAINT "towbar_integration_installations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_integration_webhook_deliveries" ADD CONSTRAINT "towbar_integration_webhook_deliveries_authorization_id_towbar_integration_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."towbar_integration_authorizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_integration_webhook_deliveries" ADD CONSTRAINT "towbar_integration_webhook_deliveries_installation_id_towbar_integration_installations_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."towbar_integration_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_integration_webhook_deliveries" ADD CONSTRAINT "towbar_integration_webhook_deliveries_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "fk_towbar_secret_sources_owner" FOREIGN KEY ("source_id","workspace_id") REFERENCES "public"."towbar_sources"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "fk_towbar_secret_apps_owner" FOREIGN KEY ("app_id","workspace_id","source_id") REFERENCES "public"."towbar_apps"("id","workspace_id","source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "fk_towbar_secret_servers_owner" FOREIGN KEY ("server_id","workspace_id") REFERENCES "public"."towbar_servers"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_agents" ADD CONSTRAINT "towbar_monitoring_agents_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_agents" ADD CONSTRAINT "towbar_monitoring_agents_removal_requested_by_towbar_users_id_fk" FOREIGN KEY ("removal_requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_agents" ADD CONSTRAINT "towbar_monitoring_agents_requested_by_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("requested_by_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_agents" ADD CONSTRAINT "towbar_monitoring_agents_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_batches" ADD CONSTRAINT "towbar_monitoring_batches_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_samples" ADD CONSTRAINT "towbar_monitoring_samples_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_deliveries" ADD CONSTRAINT "towbar_notification_deliveries_event_id_towbar_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."towbar_notification_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_delivery_attempts" ADD CONSTRAINT "towbar_notification_delivery_attempts_delivery_id_towbar_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."towbar_notification_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD CONSTRAINT "towbar_notification_events_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD CONSTRAINT "towbar_notification_events_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD CONSTRAINT "towbar_notification_events_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_threads" ADD CONSTRAINT "towbar_notification_threads_creating_delivery_id_towbar_notification_deliveries_id_fk" FOREIGN KEY ("creating_delivery_id") REFERENCES "public"."towbar_notification_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_pull_request_reports" ADD CONSTRAINT "towbar_preview_pull_request_reports_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_pull_request_reports" ADD CONSTRAINT "towbar_preview_pull_request_reports_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD CONSTRAINT "towbar_releases_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD CONSTRAINT "towbar_releases_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD CONSTRAINT "towbar_releases_preview_environment_id_towbar_preview_environments_id_fk" FOREIGN KEY ("preview_environment_id") REFERENCES "public"."towbar_preview_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_repository_webhook_cursors" ADD CONSTRAINT "towbar_repository_webhook_cursors_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_backup_assurances" ADD CONSTRAINT "towbar_resource_backup_assurances_resource_id_towbar_apps_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_backup_assurances" ADD CONSTRAINT "towbar_resource_backup_assurances_backup_operation_id_towbar_resource_operations_id_fk" FOREIGN KEY ("backup_operation_id") REFERENCES "public"."towbar_resource_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operation_events" ADD CONSTRAINT "towbar_resource_operation_events_operation_id_towbar_resource_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."towbar_resource_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_resource_id_towbar_apps_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_requested_by_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("requested_by_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_incidents" ADD CONSTRAINT "towbar_scout_alert_incidents_rule_id_towbar_scout_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."towbar_scout_alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_incidents" ADD CONSTRAINT "towbar_scout_alert_incidents_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_incidents" ADD CONSTRAINT "towbar_scout_alert_incidents_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" ADD CONSTRAINT "towbar_scout_alert_rules_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" ADD CONSTRAINT "towbar_scout_alert_rules_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" ADD CONSTRAINT "towbar_scout_alert_rules_deployable_id_towbar_apps_id_fk" FOREIGN KEY ("deployable_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_http_checks" ADD CONSTRAINT "towbar_scout_http_checks_rule_id_towbar_scout_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."towbar_scout_alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_checks" ADD CONSTRAINT "towbar_server_checks_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_checks" ADD CONSTRAINT "towbar_server_checks_requested_by_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("requested_by_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_checks" ADD CONSTRAINT "towbar_server_checks_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_credential_verifications" ADD CONSTRAINT "towbar_server_credential_verifications_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_credential_verifications" ADD CONSTRAINT "towbar_server_credential_verifications_private_key_id_towbar_workspace_private_keys_id_fk" FOREIGN KEY ("private_key_id") REFERENCES "public"."towbar_workspace_private_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_credential_verifications" ADD CONSTRAINT "towbar_server_credential_verifications_requested_by_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("requested_by_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_credential_verifications" ADD CONSTRAINT "towbar_server_credential_verifications_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_deployable_ownership" ADD CONSTRAINT "towbar_server_deployable_ownership_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_integration_states" ADD CONSTRAINT "towbar_server_integration_states_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_integration_states" ADD CONSTRAINT "towbar_server_integration_states_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_preparations" ADD CONSTRAINT "towbar_server_preparations_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_preparations" ADD CONSTRAINT "towbar_server_preparations_requested_by_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("requested_by_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_preparations" ADD CONSTRAINT "towbar_server_preparations_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD CONSTRAINT "towbar_servers_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD CONSTRAINT "towbar_servers_private_key_id_towbar_workspace_private_keys_id_fk" FOREIGN KEY ("private_key_id") REFERENCES "public"."towbar_workspace_private_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_sessions" ADD CONSTRAINT "towbar_sessions_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_entities" ADD CONSTRAINT "towbar_source_entities_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_environments" ADD CONSTRAINT "towbar_source_environments_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "towbar_source_syncs_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "towbar_source_syncs_source_environment_id_towbar_source_environments_id_fk" FOREIGN KEY ("source_environment_id") REFERENCES "public"."towbar_source_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "towbar_source_syncs_requested_by_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("requested_by_key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "towbar_source_syncs_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "fk_towbar_source_syncs_environment_owner" FOREIGN KEY ("source_environment_id","source_id") REFERENCES "public"."towbar_source_environments"("id","source_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_sources" ADD CONSTRAINT "towbar_sources_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_sources" ADD CONSTRAINT "towbar_sources_integration_installation_id_towbar_integration_installations_id_fk" FOREIGN KEY ("integration_installation_id") REFERENCES "public"."towbar_integration_installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_sources" ADD CONSTRAINT "towbar_sources_integration_authorization_id_towbar_integration_authorizations_id_fk" FOREIGN KEY ("integration_authorization_id") REFERENCES "public"."towbar_integration_authorizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_ssh_host_keys" ADD CONSTRAINT "towbar_ssh_host_keys_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_ssh_host_keys" ADD CONSTRAINT "towbar_ssh_host_keys_trusted_by_towbar_users_id_fk" FOREIGN KEY ("trusted_by") REFERENCES "public"."towbar_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_system_health_signals" ADD CONSTRAINT "towbar_system_health_signals_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_transactional_emails" ADD CONSTRAINT "towbar_transactional_emails_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_transactional_emails" ADD CONSTRAINT "towbar_transactional_emails_invitation_id_towbar_workspace_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."towbar_workspace_invitations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_invitations" ADD CONSTRAINT "towbar_workspace_invitations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_invitations" ADD CONSTRAINT "towbar_workspace_invitations_inviter_id_towbar_users_id_fk" FOREIGN KEY ("inviter_id") REFERENCES "public"."towbar_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_members" ADD CONSTRAINT "towbar_workspace_members_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_members" ADD CONSTRAINT "towbar_workspace_members_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_private_keys" ADD CONSTRAINT "towbar_workspace_private_keys_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_api_policy_creation" ON "towbar_api_key_policies" USING btree ("workspace_id","creator_user_id","creation_request_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_api_policy_workspace" ON "towbar_api_key_policies" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_api_key_hash" ON "towbar_api_keys" USING btree ("key");--> statement-breakpoint
CREATE INDEX "idx_towbar_api_keys_reference" ON "towbar_api_keys" USING btree ("reference_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_apps_environment_entity" ON "towbar_apps" USING btree ("source_environment_id","entity_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_apps_workspace" ON "towbar_apps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_apps_server" ON "towbar_apps" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_apps_archived_at" ON "towbar_apps" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_audit_workspace_actor_cursor" ON "towbar_audit_events" USING btree ("workspace_id","actor_user_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_towbar_audit_workspace_action_cursor" ON "towbar_audit_events" USING btree ("workspace_id","action","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_towbar_audit_workspace_cursor" ON "towbar_audit_events" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_towbar_audit_workspace_created" ON "towbar_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_auth_accounts_user" ON "towbar_auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_auth_account_provider" ON "towbar_auth_accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_passkey_user" ON "towbar_auth_passkeys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_passkey_credential" ON "towbar_auth_passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_auth_rate_limit_expires" ON "towbar_auth_rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_two_factor_user" ON "towbar_auth_two_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_verification_identifier" ON "towbar_auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "idx_towbar_runtime_drift" ON "towbar_deployable_runtime_states" USING btree ("drift_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployment_logs_sequence" ON "towbar_deployment_log_chunks" USING btree ("deployment_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployment_logs_created" ON "towbar_deployment_log_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployment_steps_sequence" ON "towbar_deployment_steps" USING btree ("deployment_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployments_idempotency" ON "towbar_deployments" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployments_workflow_id" ON "towbar_deployments" USING btree ("temporal_workflow_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployments_app_created" ON "towbar_deployments" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployments_server_state" ON "towbar_deployments" USING btree ("server_id","state");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployments_build_server_state" ON "towbar_deployments" USING btree ("build_server_id","state");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployments_preview_created" ON "towbar_deployments" USING btree ("preview_environment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_email_change_user" ON "towbar_email_changes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_vulnerability_findings_scan_severity" ON "towbar_image_vulnerability_findings" USING btree ("scan_id","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_vulnerability_scans_workspace_digest" ON "towbar_image_vulnerability_scans" USING btree ("workspace_id","image_digest");--> statement-breakpoint
CREATE INDEX "idx_towbar_vulnerability_scans_state_requested" ON "towbar_image_vulnerability_scans" USING btree ("state","requested_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_vulnerability_scans_deployment" ON "towbar_image_vulnerability_scans" USING btree ("deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_authorization_state" ON "towbar_integration_authorization_attempts" USING btree ("provider","state_digest");--> statement-breakpoint
CREATE INDEX "idx_towbar_integration_authorization_expiry" ON "towbar_integration_authorization_attempts" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_workspace_slug" ON "towbar_integration_authorizations" USING btree ("workspace_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_workspace_provider" ON "towbar_integration_authorizations" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE INDEX "idx_towbar_integration_workspace_id" ON "towbar_integration_authorizations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_installation_external" ON "towbar_integration_installations" USING btree ("provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_installation_workspace" ON "towbar_integration_installations" USING btree ("workspace_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_webhook_delivery" ON "towbar_integration_webhook_deliveries" USING btree ("provider","delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_webhook_payload" ON "towbar_integration_webhook_deliveries" USING btree ("provider","authorization_id","installation_id","event_name","payload_digest");--> statement-breakpoint
CREATE INDEX "idx_towbar_integration_webhook_source_occurred" ON "towbar_integration_webhook_deliveries" USING btree ("source_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_integration_webhook_accepted" ON "towbar_integration_webhook_deliveries" USING btree ("accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_managed_secret_slot" ON "towbar_managed_secrets" USING btree ("workspace_id","owner","environment","stage");--> statement-breakpoint
CREATE INDEX "towbar_monitoring_batch_age" ON "towbar_monitoring_batches" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "towbar_monitoring_server_time" ON "towbar_monitoring_samples" USING btree ("server_id","bucket_at");--> statement-breakpoint
CREATE INDEX "towbar_monitoring_workload_time" ON "towbar_monitoring_samples" USING btree ("deployable_id","bucket_at");--> statement-breakpoint
CREATE INDEX "towbar_monitoring_rollup" ON "towbar_monitoring_samples" USING btree ("resolution","bucket_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_deliveries_cursor" ON "towbar_notification_deliveries" USING btree ("created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_deliveries_event_destination" ON "towbar_notification_deliveries" USING btree ("event_id","destination_key");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_deliveries_state_next" ON "towbar_notification_deliveries" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_deliveries_destination_created" ON "towbar_notification_deliveries" USING btree ("destination_key","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_attempts_identity" ON "towbar_notification_delivery_attempts" USING btree ("delivery_id","cycle","sequence");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_attempts_delivery" ON "towbar_notification_delivery_attempts" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_events_workspace_id" ON "towbar_notification_events" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "notificationEvents_server" ON "towbar_notification_events" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_events_server_dedupe" ON "towbar_notification_events" USING btree ("server_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_events_dedupe" ON "towbar_notification_events" USING btree ("source_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_events_source_created" ON "towbar_notification_events" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_threads_destination_entity" ON "towbar_notification_threads" USING btree ("destination_key","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_threads_destination" ON "towbar_notification_threads" USING btree ("destination_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_preview_environment_ref" ON "towbar_preview_environments" USING btree ("source_id","app_id","git_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_preview_environment_hostname" ON "towbar_preview_environments" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_environment_source_status" ON "towbar_preview_environments" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_environment_expires" ON "towbar_preview_environments" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_preview_report_source_pr" ON "towbar_preview_pull_request_reports" USING btree ("source_id","pull_request_number");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_report_workspace_comment" ON "towbar_preview_pull_request_reports" USING btree ("workspace_id","comment_delivery_status");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_report_workspace_deployment" ON "towbar_preview_pull_request_reports" USING btree ("workspace_id","deployment_delivery_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_releases_deployment" ON "towbar_releases" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_releases_app_status" ON "towbar_releases" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "idx_towbar_releases_preview_status" ON "towbar_releases" USING btree ("preview_environment_id","status");--> statement-breakpoint
CREATE INDEX "idx_towbar_request_nonces_expires" ON "towbar_request_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_backup_assurances_resource" ON "towbar_resource_backup_assurances" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_backup_assurances_status" ON "towbar_resource_backup_assurances" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_resource_operation_events_sequence" ON "towbar_resource_operation_events" USING btree ("operation_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_towbar_resource_operation_events_created" ON "towbar_resource_operation_events" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_resource_operations_idempotency" ON "towbar_resource_operations" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_resource_operations_workflow" ON "towbar_resource_operations" USING btree ("temporal_workflow_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_resource_operations_resource_created" ON "towbar_resource_operations" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_resource_operations_server_state" ON "towbar_resource_operations" USING btree ("server_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "towbar_scout_one_active_incident" ON "towbar_scout_alert_incidents" USING btree ("rule_id") WHERE "towbar_scout_alert_incidents"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "towbar_scout_incidents_history" ON "towbar_scout_alert_incidents" USING btree ("workspace_id","server_id","opened_at","id");--> statement-breakpoint
CREATE INDEX "towbar_scout_rules_due" ON "towbar_scout_alert_rules" USING btree ("evaluated_at") WHERE "towbar_scout_alert_rules"."enabled" and "towbar_scout_alert_rules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "towbar_scout_rules_server" ON "towbar_scout_alert_rules" USING btree ("workspace_id","server_id");--> statement-breakpoint
CREATE INDEX "towbar_scout_http_retention" ON "towbar_scout_http_checks" USING btree ("scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_server_checks_server" ON "towbar_server_checks" USING btree ("server_id","created_at","id");--> statement-breakpoint
CREATE INDEX "idx_towbar_server_credential_verifications_server" ON "towbar_server_credential_verifications" USING btree ("server_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_server_credential_verifications_active" ON "towbar_server_credential_verifications" USING btree ("server_id") WHERE "towbar_server_credential_verifications"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "idx_towbar_server_integration_workspace_kind" ON "towbar_server_integration_states" USING btree ("workspace_id","integration_kind");--> statement-breakpoint
CREATE INDEX "idx_towbar_server_preparations_server_created" ON "towbar_server_preparations" USING btree ("server_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_server_preparations_active" ON "towbar_server_preparations" USING btree ("server_id") WHERE "towbar_server_preparations"."status" in ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_servers_workspace_ip" ON "towbar_servers" USING btree ("workspace_id","canonical_ip");--> statement-breakpoint
CREATE INDEX "idx_towbar_servers_workspace" ON "towbar_servers" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_servers_private_key" ON "towbar_servers" USING btree ("private_key_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_servers_archived_at" ON "towbar_servers" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_sessions_token" ON "towbar_sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_towbar_sessions_user_id" ON "towbar_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_sessions_expires_at" ON "towbar_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_source_entities_identity" ON "towbar_source_entities" USING btree ("source_id","entity_type","manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_source_environments_name" ON "towbar_source_environments" USING btree ("source_id","name");--> statement-breakpoint
CREATE INDEX "idx_towbar_source_environments_branch" ON "towbar_source_environments" USING btree ("source_id","branch");--> statement-breakpoint
CREATE INDEX "idx_towbar_source_syncs_source_created" ON "towbar_source_syncs" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_sources_repository" ON "towbar_sources" USING btree ("workspace_id","provider","repository_owner","repository_name");--> statement-breakpoint
CREATE INDEX "idx_towbar_sources_workspace" ON "towbar_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_ssh_host_keys_active" ON "towbar_ssh_host_keys" USING btree ("server_id","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_towbar_system_health_workspace" ON "towbar_system_health_signals" USING btree ("workspace_id","component");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_transactional_email_dedupe" ON "towbar_transactional_emails" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_towbar_transactional_email_ready" ON "towbar_transactional_emails" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_users_email" ON "towbar_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_pending_invitation" ON "towbar_workspace_invitations" USING btree ("workspace_id","email") WHERE "towbar_workspace_invitations"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_workspace_members_identity" ON "towbar_workspace_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_workspace_members_user_id" ON "towbar_workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_workspace_private_keys_name" ON "towbar_workspace_private_keys" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "idx_towbar_workspace_private_keys_workspace" ON "towbar_workspace_private_keys" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_workspaces_slug" ON "towbar_workspaces" USING btree ("slug");
--> statement-breakpoint
CREATE FUNCTION towbar_record_deployable_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO towbar_server_deployable_ownership (server_id, deployable_id)
  VALUES (NEW.server_id, NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER towbar_record_deployable_ownership
AFTER INSERT OR UPDATE OF server_id ON towbar_apps
FOR EACH ROW EXECUTE FUNCTION towbar_record_deployable_ownership();
--> statement-breakpoint
CREATE FUNCTION towbar_require_active_server() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.server_id IS NULL THEN RETURN NEW; END IF;
  PERFORM id FROM towbar_servers WHERE id = NEW.server_id AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Server is not registered' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT OR UPDATE OF server_id, archived_at ON towbar_apps
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_server_checks
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_server_preparations
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_deployments
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_resource_operations
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_image_vulnerability_scans
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_preview_environments
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT OR UPDATE ON towbar_managed_secrets
FOR EACH ROW WHEN (NEW.server_id IS NOT NULL) EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT OR UPDATE ON towbar_ssh_host_keys
FOR EACH ROW WHEN (NEW.revoked_at IS NULL) EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE FUNCTION towbar_merge_monitoring_metrics(a jsonb, b jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(key, jsonb_build_object('sum', total, 'min', minimum, 'max', maximum, 'count', samples)), '{}'::jsonb)
  FROM (
    SELECT key, sum((value->>'sum')::double precision) total,
      min((value->>'min')::double precision) minimum,
      max((value->>'max')::double precision) maximum,
      sum((value->>'count')::integer) samples
    FROM (SELECT * FROM jsonb_each(a) UNION ALL SELECT * FROM jsonb_each(b)) entries
    GROUP BY key
  ) merged
$$;
--> statement-breakpoint
CREATE TRIGGER towbar_monitoring_require_active_server
BEFORE INSERT OR UPDATE ON towbar_monitoring_agents
FOR EACH ROW WHEN (NEW.desired_state = 'enabled') EXECUTE FUNCTION towbar_require_active_server();
