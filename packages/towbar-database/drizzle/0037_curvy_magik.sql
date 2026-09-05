ALTER TABLE "towbar_managed_secrets" DROP CONSTRAINT "towbar_managed_secret_owner";--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" DROP CONSTRAINT "fk_towbar_secret_servers_owner";
--> statement-breakpoint
ALTER TABLE "towbar_servers" DROP CONSTRAINT "towbar_servers_source_id_towbar_sources_id_fk";
--> statement-breakpoint
DROP INDEX "uq_towbar_servers_source_ip";--> statement-breakpoint
DROP INDEX "uq_towbar_servers_secret_owner";--> statement-breakpoint
CREATE TEMPORARY TABLE "towbar_server_deduplication" AS
WITH ranked AS (
  SELECT
    "id",
    first_value("id") OVER (
      PARTITION BY "workspace_id", "canonical_ip"
      ORDER BY ("archived_at" IS NULL) DESC, "updated_at" DESC, "id"
    ) AS "keeper_id"
  FROM "towbar_servers"
)
SELECT "id" AS "duplicate_id", "keeper_id"
FROM ranked
WHERE "id" <> "keeper_id";--> statement-breakpoint
UPDATE "towbar_apps" AS target
SET "server_id" = mapping."keeper_id"
FROM "towbar_server_deduplication" AS mapping
WHERE target."server_id" = mapping."duplicate_id";--> statement-breakpoint
UPDATE "towbar_preview_environments" AS target
SET "server_id" = mapping."keeper_id"
FROM "towbar_server_deduplication" AS mapping
WHERE target."server_id" = mapping."duplicate_id";--> statement-breakpoint
UPDATE "towbar_deployments" AS target
SET "server_id" = mapping."keeper_id"
FROM "towbar_server_deduplication" AS mapping
WHERE target."server_id" = mapping."duplicate_id";--> statement-breakpoint
UPDATE "towbar_resource_operations" AS target
SET "server_id" = mapping."keeper_id"
FROM "towbar_server_deduplication" AS mapping
WHERE target."server_id" = mapping."duplicate_id";--> statement-breakpoint
DELETE FROM "towbar_managed_secrets" WHERE "server_id" IS NOT NULL;--> statement-breakpoint
DELETE FROM "towbar_server_checks"
WHERE "server_id" IN (SELECT "duplicate_id" FROM "towbar_server_deduplication");--> statement-breakpoint
DELETE FROM "towbar_server_preparations"
WHERE "server_id" IN (SELECT "duplicate_id" FROM "towbar_server_deduplication");--> statement-breakpoint
DELETE FROM "towbar_ssh_host_keys"
WHERE "server_id" IN (SELECT "duplicate_id" FROM "towbar_server_deduplication");--> statement-breakpoint
DELETE FROM "towbar_servers"
WHERE "id" IN (SELECT "duplicate_id" FROM "towbar_server_deduplication");--> statement-breakpoint
DROP TABLE "towbar_server_deduplication";--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ALTER COLUMN "source_id" DROP NOT NULL;--> statement-breakpoint
UPDATE "towbar_resource_operations"
SET "source_id" = NULL
WHERE "type" = 'cleanup_orphans';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_servers_workspace_ip" ON "towbar_servers" USING btree ("workspace_id","canonical_ip");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_servers_secret_owner" ON "towbar_servers" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "fk_towbar_secret_servers_owner" FOREIGN KEY ("server_id","workspace_id") REFERENCES "public"."towbar_servers"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_servers" DROP COLUMN "source_id";--> statement-breakpoint
ALTER TABLE "towbar_servers" DROP COLUMN "source_revision";--> statement-breakpoint
ALTER TABLE "towbar_managed_secrets" ADD CONSTRAINT "towbar_managed_secret_owner" CHECK ((
    ("towbar_managed_secrets"."owner" = 'workspace:' || "towbar_managed_secrets"."workspace_id"::text AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'source:' || "towbar_managed_secrets"."source_id"::text AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'app:' || "towbar_managed_secrets"."app_id"::text AND "towbar_managed_secrets"."app_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NOT NULL AND "towbar_managed_secrets"."server_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'server:' || "towbar_managed_secrets"."server_id"::text AND "towbar_managed_secrets"."server_id" IS NOT NULL AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL)
    OR ("towbar_managed_secrets"."owner" = 'notifications' AND "towbar_managed_secrets"."source_id" IS NULL AND "towbar_managed_secrets"."app_id" IS NULL AND "towbar_managed_secrets"."server_id" IS NULL)
  ) IS TRUE);--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD CONSTRAINT "chk_towbar_resource_operations_owner" CHECK (("towbar_resource_operations"."type" = 'cleanup_orphans' AND "towbar_resource_operations"."source_id" IS NULL AND "towbar_resource_operations"."resource_id" IS NULL) OR ("towbar_resource_operations"."type" <> 'cleanup_orphans' AND "towbar_resource_operations"."source_id" IS NOT NULL AND "towbar_resource_operations"."resource_id" IS NOT NULL));
