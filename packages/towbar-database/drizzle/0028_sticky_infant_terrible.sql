CREATE TYPE "public"."towbar_deployment_plan_delivery_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_plan_status" AS ENUM('ready', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."towbar_deployment_plan_trigger" AS ENUM('manual', 'pull_request');--> statement-breakpoint
CREATE TABLE "towbar_deployment_plan_github_checks" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"check_run_id" varchar(40),
	"status" "towbar_deployment_plan_delivery_status" DEFAULT 'pending' NOT NULL,
	"error_message" varchar(1000),
	"last_attempted_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_deployment_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"requested_by" uuid,
	"identity_digest" varchar(64) NOT NULL,
	"trigger" "towbar_deployment_plan_trigger" NOT NULL,
	"status" "towbar_deployment_plan_status" NOT NULL,
	"pull_request_number" integer,
	"branch" varchar(255) NOT NULL,
	"current_commit_sha" varchar(64),
	"target_commit_sha" varchar(64) NOT NULL,
	"current_manifest_digest" varchar(64),
	"target_manifest_digest" varchar(64),
	"candidate_digest" varchar(64) NOT NULL,
	"plan" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_towbar_deployment_plans_trigger" CHECK (("towbar_deployment_plans"."trigger" = 'manual' AND "towbar_deployment_plans"."pull_request_number" IS NULL) OR ("towbar_deployment_plans"."trigger" = 'pull_request' AND "towbar_deployment_plans"."pull_request_number" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "towbar_deployment_plan_github_checks" ADD CONSTRAINT "towbar_deployment_plan_github_checks_plan_id_towbar_deployment_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."towbar_deployment_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployment_plans" ADD CONSTRAINT "towbar_deployment_plans_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployment_plans" ADD CONSTRAINT "towbar_deployment_plans_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_deployment_plans" ADD CONSTRAINT "towbar_deployment_plans_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_deployment_plan_checks_status" ON "towbar_deployment_plan_github_checks" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployment_plans_identity" ON "towbar_deployment_plans" USING btree ("source_id","identity_digest");--> statement-breakpoint
CREATE INDEX "idx_towbar_deployment_plans_source_created" ON "towbar_deployment_plans" USING btree ("source_id","created_at");