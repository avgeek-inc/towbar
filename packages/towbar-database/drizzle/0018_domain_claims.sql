CREATE TABLE "towbar_domain_claims" (
  "workspace_id" uuid NOT NULL REFERENCES "towbar_workspaces"("id") ON DELETE CASCADE,
  "hostname" varchar(253) NOT NULL,
  "source_environment_id" uuid NOT NULL REFERENCES "towbar_source_environments"("id") ON DELETE CASCADE,
  "desired_app_id" uuid REFERENCES "towbar_apps"("id") ON DELETE SET NULL,
  "active_app_id" uuid REFERENCES "towbar_apps"("id") ON DELETE SET NULL,
  "active_deployment_id" uuid REFERENCES "towbar_deployments"("id") ON DELETE SET NULL,
  "released_app_id" uuid REFERENCES "towbar_apps"("id") ON DELETE SET NULL,
  "pending_deployment_id" uuid REFERENCES "towbar_deployments"("id") ON DELETE SET NULL,
  "generation" uuid DEFAULT gen_random_uuid() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("workspace_id", "hostname")
);
--> statement-breakpoint
CREATE INDEX "idx_towbar_domain_claims_environment" ON "towbar_domain_claims"("source_environment_id");

--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "domain_handoff_snapshot" jsonb DEFAULT '[]'::jsonb NOT NULL;

--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_domain_claims_owner" ON "towbar_domain_claims"("hostname") WHERE "desired_app_id" IS NOT NULL OR "active_app_id" IS NOT NULL;
