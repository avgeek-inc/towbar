ALTER TYPE "public"."towbar_deployment_state" ADD VALUE 'skipped' BEFORE 'failed';--> statement-breakpoint
ALTER TABLE "towbar_deployments" ALTER COLUMN "requested_by" DROP NOT NULL;