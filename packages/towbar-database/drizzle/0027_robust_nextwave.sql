CREATE TYPE "public"."towbar_preview_report_delivery_status" AS ENUM('pending', 'published', 'failed');--> statement-breakpoint
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
ALTER TABLE "towbar_preview_environments" ADD COLUMN "cleanup_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD COLUMN "last_cleanup_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "towbar_preview_environments" ADD COLUMN "next_cleanup_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "towbar_preview_pull_request_reports" ADD CONSTRAINT "towbar_preview_pull_request_reports_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_preview_pull_request_reports" ADD CONSTRAINT "towbar_preview_pull_request_reports_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_preview_report_source_pr" ON "towbar_preview_pull_request_reports" USING btree ("source_id","pull_request_number");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_report_workspace_comment" ON "towbar_preview_pull_request_reports" USING btree ("workspace_id","comment_delivery_status");--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_report_workspace_deployment" ON "towbar_preview_pull_request_reports" USING btree ("workspace_id","deployment_delivery_status");