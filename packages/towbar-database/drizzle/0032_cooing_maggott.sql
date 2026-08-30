ALTER TABLE "towbar_deployments" ADD COLUMN "image_digest" varchar(71);--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "image_platform" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD COLUMN "image_digest" varchar(71);--> statement-breakpoint
ALTER TABLE "towbar_releases" ADD COLUMN "image_platform" varchar(64);