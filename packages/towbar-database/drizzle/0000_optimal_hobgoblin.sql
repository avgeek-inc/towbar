CREATE TYPE "public"."towbar_check_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_credential_verification_status" AS ENUM('unverified', 'verified', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_state" AS ENUM('queued', 'waiting_for_server', 'preparing', 'validating_credentials', 'checking_server', 'fetching_source', 'resolving_secrets', 'transferring', 'building', 'starting_candidate', 'checking_health', 'configuring_routing', 'provisioning_tls', 'checking_public_endpoint', 'switching_traffic', 'cleaning_up', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_step_status" AS ENUM('waiting', 'running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."towbar_release_status" AS ENUM('current', 'previous', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."towbar_source_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."towbar_source_sync_status" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_workspace_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "towbar_apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"manifest_id" varchar(63) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" varchar(500),
	"config" jsonb NOT NULL,
	"config_digest" varchar(64) NOT NULL,
	"source_revision" varchar(64) NOT NULL,
	"archived_at" timestamp with time zone,
	"decommissioned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(160) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" varchar(255),
	"request_id" varchar(100),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_auth_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"idempotency_key" varchar(255) NOT NULL,
	"temporal_workflow_id" varchar(255) NOT NULL,
	"state" "towbar_deployment_state" DEFAULT 'queued' NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"manifest_digest" varchar(64) NOT NULL,
	"app_snapshot" jsonb NOT NULL,
	"server_snapshot" jsonb NOT NULL,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"installation_id" varchar(40) NOT NULL,
	"account_login" varchar(255) NOT NULL,
	"account_type" varchar(40) NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_github_webhook_deliveries" (
	"delivery_id" varchar(100) PRIMARY KEY NOT NULL,
	"event_name" varchar(100) NOT NULL,
	"action" varchar(100),
	"payload_digest" varchar(64) NOT NULL,
	"source_id" uuid,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "towbar_password_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_password_reset_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"status" "towbar_release_status" NOT NULL,
	"commit_sha" varchar(64) NOT NULL,
	"image_tag" varchar(255) NOT NULL,
	"container_name" varchar(255) NOT NULL,
	"promoted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
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
CREATE TABLE "towbar_server_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"status" "towbar_check_status" DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_servers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"canonical_ip" varchar(64) NOT NULL,
	"config" jsonb NOT NULL,
	"config_digest" varchar(64) NOT NULL,
	"source_revision" varchar(64) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_source_server_declarations" (
	"source_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"config_digest" varchar(64) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_towbar_source_server_declarations" PRIMARY KEY("source_id","server_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_source_syncs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"status" "towbar_source_sync_status" DEFAULT 'queued' NOT NULL,
	"commit_sha" varchar(64),
	"manifest_digest" varchar(64),
	"raw_manifest" text,
	"normalized_manifest" jsonb,
	"reconciliation" jsonb,
	"issues" jsonb,
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"github_installation_id" uuid NOT NULL,
	"repository_owner" varchar(255) NOT NULL,
	"repository_name" varchar(255) NOT NULL,
	"branch" varchar(255) NOT NULL,
	"status" "towbar_source_status" DEFAULT 'active' NOT NULL,
	"latest_commit_sha" varchar(64),
	"latest_manifest_digest" varchar(64),
	"latest_successful_sync_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_ssh_host_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"algorithm" varchar(80) NOT NULL,
	"fingerprint" varchar(255) NOT NULL,
	"public_key" text NOT NULL,
	"trusted_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_workspace_aws_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"access_key_suffix" varchar(8) NOT NULL,
	"region" varchar(64) NOT NULL,
	"verification_status" "towbar_credential_verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_message" varchar(500),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "towbar_workspace_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pk_towbar_workspace_members" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_audit_events" ADD CONSTRAINT "towbar_audit_events_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_audit_events" ADD CONSTRAINT "towbar_audit_events_actor_user_id_towbar_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_auth_codes" ADD CONSTRAINT "towbar_auth_codes_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployment_log_chunks" ADD CONSTRAINT "towbar_deployment_log_chunks_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployment_steps" ADD CONSTRAINT "towbar_deployment_steps_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_github_installations" ADD CONSTRAINT "towbar_github_installations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_github_webhook_deliveries" ADD CONSTRAINT "towbar_github_webhook_deliveries_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_password_credentials" ADD CONSTRAINT "towbar_password_credentials_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_password_reset_tokens" ADD CONSTRAINT "towbar_password_reset_tokens_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD CONSTRAINT "towbar_releases_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD CONSTRAINT "towbar_releases_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_checks" ADD CONSTRAINT "towbar_server_checks_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_checks" ADD CONSTRAINT "towbar_server_checks_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD CONSTRAINT "towbar_servers_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_sessions" ADD CONSTRAINT "towbar_sessions_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_server_declarations" ADD CONSTRAINT "towbar_source_server_declarations_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_server_declarations" ADD CONSTRAINT "towbar_source_server_declarations_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "towbar_source_syncs_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "towbar_source_syncs_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_sources" ADD CONSTRAINT "towbar_sources_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_sources" ADD CONSTRAINT "towbar_sources_github_installation_id_towbar_github_installations_id_fk" FOREIGN KEY ("github_installation_id") REFERENCES "public"."towbar_github_installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_ssh_host_keys" ADD CONSTRAINT "towbar_ssh_host_keys_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_ssh_host_keys" ADD CONSTRAINT "towbar_ssh_host_keys_trusted_by_towbar_users_id_fk" FOREIGN KEY ("trusted_by") REFERENCES "public"."towbar_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_aws_credentials" ADD CONSTRAINT "towbar_workspace_aws_credentials_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_members" ADD CONSTRAINT "towbar_workspace_members_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_members" ADD CONSTRAINT "towbar_workspace_members_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_apps_source_manifest_id" ON "towbar_apps" USING btree ("source_id","manifest_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_apps_workspace" ON "towbar_apps" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_apps_server" ON "towbar_apps" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_apps_archived_at" ON "towbar_apps" USING btree ("archived_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_audit_workspace_created" ON "towbar_audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_auth_codes_code_hash" ON "towbar_auth_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "idx_towbar_auth_codes_expires_at" ON "towbar_auth_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployment_logs_sequence" ON "towbar_deployment_log_chunks" USING btree ("deployment_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployment_logs_created" ON "towbar_deployment_log_chunks" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployment_steps_sequence" ON "towbar_deployment_steps" USING btree ("deployment_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployments_idempotency" ON "towbar_deployments" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployments_workflow_id" ON "towbar_deployments" USING btree ("temporal_workflow_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployments_app_created" ON "towbar_deployments" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployments_server_state" ON "towbar_deployments" USING btree ("server_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_github_installation_id" ON "towbar_github_installations" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_github_installations_workspace" ON "towbar_github_installations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_webhooks_accepted_at" ON "towbar_github_webhook_deliveries" USING btree ("accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_password_reset_token_hash" ON "towbar_password_reset_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_towbar_password_reset_expires_at" ON "towbar_password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_releases_deployment" ON "towbar_releases" USING btree ("deployment_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_releases_app_status" ON "towbar_releases" USING btree ("app_id","status");--> statement-breakpoint
CREATE INDEX "idx_towbar_request_nonces_expires" ON "towbar_request_nonces" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_server_checks_server" ON "towbar_server_checks" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_servers_workspace_ip" ON "towbar_servers" USING btree ("workspace_id","canonical_ip");--> statement-breakpoint
CREATE INDEX "idx_towbar_servers_archived_at" ON "towbar_servers" USING btree ("archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_sessions_token_hash" ON "towbar_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_towbar_sessions_user_id" ON "towbar_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_sessions_expires_at" ON "towbar_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_source_syncs_source_created" ON "towbar_source_syncs" USING btree ("source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_sources_repository_branch" ON "towbar_sources" USING btree ("workspace_id","repository_owner","repository_name","branch");--> statement-breakpoint
CREATE INDEX "idx_towbar_sources_workspace" ON "towbar_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_ssh_host_keys_active" ON "towbar_ssh_host_keys" USING btree ("server_id","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_users_email" ON "towbar_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_aws_credentials_workspace" ON "towbar_workspace_aws_credentials" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_workspace_members_user_id" ON "towbar_workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_workspaces_slug" ON "towbar_workspaces" USING btree ("slug");