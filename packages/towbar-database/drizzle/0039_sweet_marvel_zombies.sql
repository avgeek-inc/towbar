CREATE TABLE "towbar_workspace_aws_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"access_key_suffix" varchar(8) NOT NULL,
	"region" varchar(64) NOT NULL,
	"verification_status" "towbar_credential_verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_message" varchar(500),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_source_aws_credentials" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "towbar_source_aws_credentials" CASCADE;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" DROP CONSTRAINT "towbar_managed_secret_owner";--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" DROP CONSTRAINT "towbar_managed_secret_stage";--> statement-breakpoint
DELETE FROM "towbar_managed_secrets" WHERE "owner" = 'notifications';--> statement-breakpoint
ALTER TABLE "towbar_workspace_aws_credentials" ADD CONSTRAINT "towbar_workspace_aws_credentials_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_aws_credentials_workspace" ON "towbar_workspace_aws_credentials" USING btree ("workspace_id");--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secret_owner" CHECK ((
    ("towbar_managed_secrets"."owner" = 'workspace:' || "towbar_managed_secrets"."workspace_id"::text AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'source:' || "towbar_managed_secrets"."source_id"::text AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'app:' || "towbar_managed_secrets"."app_id"::text AND "towbar_managed_secrets"."app_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'server:' || "towbar_managed_secrets"."server_id"::text AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL)
  ) IS TRUE);--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secret_stage" CHECK ((
    ("towbar_managed_secrets"."stage" IN ('build', 'deployment', 'pre_deploy', 'post_deploy') AND ("towbar_managed_secrets"."owner" = 'workspace:' || "towbar_managed_secrets"."workspace_id"::text OR "towbar_managed_secrets"."app_id" IS NOT NULL OR ("towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)))
    OR ("towbar_managed_secrets"."stage" = 'credentials' AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."environment" = 'production')
  ));
