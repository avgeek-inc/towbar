ALTER TABLE "towbar_apps" ADD COLUMN "deployment_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD COLUMN "source_input_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "deployment_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "source_input_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD COLUMN "deployment_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD COLUMN "source_input_digest" varchar(64);