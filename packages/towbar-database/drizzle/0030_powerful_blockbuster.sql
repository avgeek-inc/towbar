ALTER TABLE "towbar_apps" ADD COLUMN "auto_deploy_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD COLUMN "deferred_automatic_deployment" jsonb;--> statement-breakpoint
ALTER TABLE "towbar_sources" ADD COLUMN "auto_deploy_paused" boolean DEFAULT false NOT NULL;