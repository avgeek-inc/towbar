ALTER TABLE "towbar_preview_pull_request_reports" ADD COLUMN "comment_delivery_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "towbar_preview_pull_request_reports" ADD COLUMN "comment_next_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "towbar_preview_pull_request_reports" ADD COLUMN "deployment_delivery_attempts" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "towbar_preview_pull_request_reports" ADD COLUMN "deployment_next_attempt_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "github_deployment_status" varchar(40);
--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_report_comment_retry" ON "towbar_preview_pull_request_reports" ("comment_next_attempt_at") WHERE "comment_delivery_status" IN ('pending', 'failed');
--> statement-breakpoint
CREATE INDEX "idx_towbar_preview_report_deployment_retry" ON "towbar_preview_pull_request_reports" ("deployment_next_attempt_at") WHERE "deployment_delivery_status" IN ('pending', 'failed');
