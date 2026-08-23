CREATE TYPE "public"."towbar_resource_operation_state" AS ENUM('queued', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_resource_operation_type" AS ENUM('backup', 'capture_logs', 'cleanup_orphans', 'restart', 'restore', 'start', 'stop');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_desired_state" AS ENUM('running', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_drift_state" AS ENUM('drifted', 'in_sync', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_health_state" AS ENUM('healthy', 'none', 'starting', 'unhealthy', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."towbar_runtime_observed_state" AS ENUM('missing', 'running', 'stopped', 'unknown');--> statement-breakpoint
CREATE TABLE "towbar_deployable_runtime_states" (
	"app_id" uuid PRIMARY KEY NOT NULL,
	"desired_state" "towbar_runtime_desired_state" DEFAULT 'running' NOT NULL,
	"observed_state" "towbar_runtime_observed_state" DEFAULT 'unknown' NOT NULL,
	"health_status" "towbar_runtime_health_state" DEFAULT 'unknown' NOT NULL,
	"drift_status" "towbar_runtime_drift_state" DEFAULT 'unknown' NOT NULL,
	"drift_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_container_name" varchar(255),
	"observed_image" varchar(512),
	"last_check_id" uuid,
	"checked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_resource_operations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"resource_id" uuid,
	"server_id" uuid NOT NULL,
	"requested_by" uuid,
	"idempotency_key" varchar(255) NOT NULL,
	"temporal_workflow_id" varchar(255) NOT NULL,
	"type" "towbar_resource_operation_type" NOT NULL,
	"state" "towbar_resource_operation_state" DEFAULT 'queued' NOT NULL,
	"request" jsonb NOT NULL,
	"result" jsonb,
	"app_snapshot" jsonb,
	"server_snapshot" jsonb NOT NULL,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_deployable_runtime_states" ADD CONSTRAINT "towbar_deployable_runtime_states_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployable_runtime_states" ADD CONSTRAINT "towbar_deployable_runtime_states_last_check_id_towbar_server_checks_id_fk" FOREIGN KEY ("last_check_id") REFERENCES "public"."towbar_server_checks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_resource_id_towbar_apps_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "towbar_resource_operations_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_runtime_drift" ON "towbar_deployable_runtime_states" USING btree ("drift_status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_resource_operations_idempotency" ON "towbar_resource_operations" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_resource_operations_workflow" ON "towbar_resource_operations" USING btree ("temporal_workflow_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_resource_operations_resource_created" ON "towbar_resource_operations" USING btree ("resource_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_resource_operations_server_state" ON "towbar_resource_operations" USING btree ("server_id","state");