CREATE TYPE "public"."towbar_deployment_environment" AS ENUM('production', 'preview');--> statement-breakpoint
CREATE TYPE "public"."towbar_preview_environment_status" AS ENUM('building', 'healthy', 'failed', 'deleting', 'cleanup_failed', 'deleted');--> statement-breakpoint
CREATE TABLE "towbar_preview_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"branch" varchar(255) NOT NULL,
	"git_ref" varchar(512) NOT NULL,
	"hostname" varchar(253) NOT NULL,
	"runtime_id" varchar(255) NOT NULL,
	"latest_commit_sha" varchar(64) NOT NULL,
	"latest_deployment_id" uuid,
	"status" "towbar_preview_environment_status" DEFAULT 'building' NOT NULL,
	"error_message" varchar(1000),
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "environment" "towbar_deployment_environment" DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "git_ref" varchar(512);--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "hostname" varchar(253);--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "preview_environment_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD COLUMN "environment" "towbar_deployment_environment" DEFAULT 'production' NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD COLUMN "git_ref" varchar(512);--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD COLUMN "preview_environment_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD CONSTRAINT "towbar_preview_environments_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_preview_environment_ref" ON "towbar_preview_environments" USING btree ("source_id","app_id","git_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_preview_environment_hostname" ON "towbar_preview_environments" USING btree ("hostname");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_environment_source_status" ON "towbar_preview_environments" USING btree ("source_id","status");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_environment_expires" ON "towbar_preview_environments" USING btree ("status","expires_at");--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "towbar_deployments_preview_environment_id_towbar_preview_environments_id_fk" FOREIGN KEY ("preview_environment_id") REFERENCES "public"."towbar_preview_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD CONSTRAINT "towbar_releases_preview_environment_id_towbar_preview_environments_id_fk" FOREIGN KEY ("preview_environment_id") REFERENCES "public"."towbar_preview_environments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_deployments_preview_created" ON "towbar_deployments" USING btree ("preview_environment_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_releases_preview_status" ON "towbar_releases" USING btree ("preview_environment_id","status");--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD CONSTRAINT "chk_towbar_deployments_environment" CHECK (("towbar_deployments"."environment" = 'production' AND "towbar_deployments"."preview_environment_id" IS NULL AND "towbar_deployments"."git_ref" IS NULL AND "towbar_deployments"."hostname" IS NULL) OR ("towbar_deployments"."environment" = 'preview' AND "towbar_deployments"."preview_environment_id" IS NOT NULL AND "towbar_deployments"."git_ref" IS NOT NULL AND "towbar_deployments"."hostname" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD CONSTRAINT "chk_towbar_releases_environment" CHECK (("towbar_releases"."environment" = 'production' AND "towbar_releases"."preview_environment_id" IS NULL AND "towbar_releases"."git_ref" IS NULL) OR ("towbar_releases"."environment" = 'preview' AND "towbar_releases"."preview_environment_id" IS NOT NULL AND "towbar_releases"."git_ref" IS NOT NULL));