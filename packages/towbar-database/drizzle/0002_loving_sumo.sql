CREATE TYPE "public"."towbar_deployment_kind" AS ENUM('deploy', 'rollback');--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "kind" "towbar_deployment_kind" DEFAULT 'deploy' NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "rollback_release_snapshot" jsonb;