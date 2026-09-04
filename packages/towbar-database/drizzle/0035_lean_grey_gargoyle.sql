CREATE TABLE "towbar_managed_secrets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid,
	"app_id" uuid,
	"server_id" uuid,
	"owner" text NOT NULL,
	"environment" "towbar_deployment_environment" DEFAULT 'production' NOT NULL,
	"stage" text NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"keys" jsonb NOT NULL,
	"revision" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_managed_secret_owner" CHECK ((
    ("towbar_managed_secrets"."owner" = 'source:' || "towbar_managed_secrets"."source_id"::text AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'app:' || "towbar_managed_secrets"."app_id"::text AND "towbar_managed_secrets"."app_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'server:' || "towbar_managed_secrets"."server_id"::text AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."app_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'notifications' AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
  ) IS TRUE),
	CONSTRAINT "towbar_managed_secret_stage" CHECK ((
    ("towbar_managed_secrets"."stage" IN ('build', 'deployment', 'pre_deploy', 'post_deploy') AND ("towbar_managed_secrets"."app_id" IS NOT NULL OR ("towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL AND "towbar_managed_secrets"."environment" = 'production')))
    OR ("towbar_managed_secrets"."stage" = 'credentials' AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."environment" = 'production')
    OR ("towbar_managed_secrets"."stage" IN ('slack', 'smtp') AND "towbar_managed_secrets"."owner" = 'notifications' AND "towbar_managed_secrets"."environment" = 'production')
  ))
);
--> statement-breakpoint
ALTER TABLE "towbar_deployments" ADD COLUMN "secret_revisions" jsonb;
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secrets_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_managed_secret_slot" ON "towbar_managed_secrets" USING btree ("workspace_id","owner","environment","stage");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_apps_secret_owner" ON "towbar_apps" USING btree ("id","workspace_id","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_servers_secret_owner" ON "towbar_servers" USING btree ("id","workspace_id","source_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_sources_secret_owner" ON "towbar_sources" USING btree ("id","workspace_id");
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "fk_towbar_secret_sources_owner" FOREIGN KEY ("source_id","workspace_id") REFERENCES "public"."towbar_sources"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "fk_towbar_secret_apps_owner" FOREIGN KEY ("app_id","workspace_id","source_id") REFERENCES "public"."towbar_apps"("id","workspace_id","source_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "fk_towbar_secret_servers_owner" FOREIGN KEY ("server_id","workspace_id","source_id") REFERENCES "public"."towbar_servers"("id","workspace_id","source_id") ON DELETE cascade ON UPDATE no action;
