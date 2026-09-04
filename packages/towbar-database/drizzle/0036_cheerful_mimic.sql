ALTER TABLE "towbar_managed_secrets" DROP CONSTRAINT "towbar_managed_secret_owner";--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" DROP CONSTRAINT "towbar_managed_secret_stage";--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secret_owner" CHECK ((
    ("towbar_managed_secrets"."owner" = 'workspace:' || "towbar_managed_secrets"."workspace_id"::text AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'source:' || "towbar_managed_secrets"."source_id"::text AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'app:' || "towbar_managed_secrets"."app_id"::text AND "towbar_managed_secrets"."app_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'server:' || "towbar_managed_secrets"."server_id"::text AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."app_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'notifications' AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
  ) IS TRUE);--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secret_stage" CHECK ((
    ("towbar_managed_secrets"."stage" IN ('build', 'deployment', 'pre_deploy', 'post_deploy') AND ("towbar_managed_secrets"."owner" = 'workspace:' || "towbar_managed_secrets"."workspace_id"::text OR "towbar_managed_secrets"."app_id" IS NOT NULL OR ("towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)))
    OR ("towbar_managed_secrets"."stage" = 'credentials' AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."environment" = 'production')
    OR ("towbar_managed_secrets"."stage" IN ('slack', 'smtp') AND "towbar_managed_secrets"."owner" = 'notifications' AND "towbar_managed_secrets"."environment" = 'production')
  ));