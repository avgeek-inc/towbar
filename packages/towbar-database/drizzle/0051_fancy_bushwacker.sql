CREATE TABLE "towbar_source_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"entity_type" varchar(16) NOT NULL,
	"manifest_id" varchar(63) NOT NULL,
	"resource_type" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_source_entity_kind" CHECK (("towbar_source_entities"."entity_type" = 'app' AND "towbar_source_entities"."resource_type" IS NULL) OR ("towbar_source_entities"."entity_type" = 'resource' AND "towbar_source_entities"."resource_type" IN ('image', 'postgres', 'redis')))
);
--> statement-breakpoint
CREATE TABLE "towbar_source_environments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"name" varchar(63) NOT NULL,
	"branch" varchar(255) NOT NULL,
	"mapping_revision" uuid DEFAULT gen_random_uuid() NOT NULL,
	"previews_enabled" boolean DEFAULT false NOT NULL,
	"latest_commit_sha" varchar(64),
	"latest_manifest_digest" varchar(64),
	"latest_successful_sync_id" uuid,
	"auto_deploy_paused" boolean DEFAULT false NOT NULL,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "uq_towbar_apps_source_manifest_id";--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" DROP CONSTRAINT "towbar_managed_secret_stage";--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ALTER COLUMN "environment" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ALTER COLUMN "environment" SET DATA TYPE varchar(80) USING "environment"::text;--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ALTER COLUMN "environment" SET DEFAULT 'production';--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD COLUMN "entity_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD COLUMN "source_environment_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD COLUMN "required_secrets" jsonb;--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD COLUMN "slug" varchar(63);--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD COLUMN "source_environment_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD COLUMN "mapping_revision" uuid;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD COLUMN "deploy_after_sync" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_source_entities" ADD CONSTRAINT "towbar_source_entities_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_environments" ADD CONSTRAINT "towbar_source_environments_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_source_entities_identity" ON "towbar_source_entities" USING btree ("source_id","entity_type","manifest_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_source_entities_owner" ON "towbar_source_entities" USING btree ("id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_source_environments_name" ON "towbar_source_environments" USING btree ("source_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_source_environments_owner" ON "towbar_source_environments" USING btree ("id","source_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_source_environments_branch" ON "towbar_source_environments" USING btree ("source_id","branch");--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_entity_id_towbar_source_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."towbar_source_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_apps" ADD CONSTRAINT "towbar_apps_source_environment_id_towbar_source_environments_id_fk" FOREIGN KEY ("source_environment_id") REFERENCES "public"."towbar_source_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_syncs" ADD CONSTRAINT "towbar_source_syncs_source_environment_id_towbar_source_environments_id_fk" FOREIGN KEY ("source_environment_id") REFERENCES "public"."towbar_source_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_apps_environment_entity" ON "towbar_apps" USING btree ("source_environment_id","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_servers_workspace_slug" ON "towbar_servers" USING btree ("workspace_id","slug");
--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secret_stage" CHECK (
  ("stage" IN ('build', 'deployment', 'pre_deploy', 'post_deploy') AND ("owner" = 'workspace:' || "workspace_id"::text OR "app_id" IS NOT NULL OR ("source_id" IS NOT NULL AND "server_id" IS NULL)))
  OR ("stage" = 'credentials' AND "server_id" IS NOT NULL AND "environment" = 'production')
);
