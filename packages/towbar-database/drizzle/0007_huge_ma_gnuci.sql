ALTER TABLE "towbar_workspace_aws_credentials" RENAME TO "towbar_source_aws_credentials";--> statement-breakpoint
ALTER TABLE "towbar_source_aws_credentials" DROP CONSTRAINT "towbar_workspace_aws_credentials_workspace_id_towbar_workspaces_id_fk";--> statement-breakpoint
DROP INDEX "uq_towbar_servers_workspace_ip";--> statement-breakpoint
DROP INDEX "uq_towbar_aws_credentials_workspace";--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD COLUMN "source_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_source_aws_credentials" ADD COLUMN "source_id" uuid;--> statement-breakpoint
CREATE TEMP TABLE "towbar_server_source_migration" AS
WITH "server_sources" AS (
  SELECT "server_id", "source_id" FROM "towbar_source_server_declarations"
  UNION
  SELECT "server_id", "source_id" FROM "towbar_apps"
  UNION
  SELECT "server_id", "source_id" FROM "towbar_deployments"
),
"ranked" AS (
  SELECT
    "server_id" AS "old_server_id",
    "source_id",
    row_number() OVER (PARTITION BY "server_id" ORDER BY "source_id") AS "source_rank"
  FROM "server_sources"
)
SELECT
  "old_server_id",
  "source_id",
  CASE WHEN "source_rank" = 1 THEN "old_server_id" ELSE gen_random_uuid() END AS "new_server_id"
FROM "ranked";--> statement-breakpoint
UPDATE "towbar_servers" AS "server"
SET "source_id" = "mapping"."source_id"
FROM "towbar_server_source_migration" AS "mapping"
WHERE "mapping"."old_server_id" = "server"."id"
  AND "mapping"."new_server_id" = "mapping"."old_server_id";--> statement-breakpoint
INSERT INTO "towbar_servers" (
  "id",
  "source_id",
  "workspace_id",
  "canonical_ip",
  "config",
  "config_digest",
  "source_revision",
  "archived_at",
  "created_at",
  "updated_at"
)
SELECT
  "mapping"."new_server_id",
  "mapping"."source_id",
  "server"."workspace_id",
  "server"."canonical_ip",
  "server"."config",
  "server"."config_digest",
  "server"."source_revision",
  "server"."archived_at",
  "server"."created_at",
  "server"."updated_at"
FROM "towbar_server_source_migration" AS "mapping"
INNER JOIN "towbar_servers" AS "server"
  ON "server"."id" = "mapping"."old_server_id"
WHERE "mapping"."new_server_id" <> "mapping"."old_server_id";--> statement-breakpoint
UPDATE "towbar_apps" AS "app"
SET "server_id" = "mapping"."new_server_id"
FROM "towbar_server_source_migration" AS "mapping"
WHERE "mapping"."old_server_id" = "app"."server_id"
  AND "mapping"."source_id" = "app"."source_id";--> statement-breakpoint
UPDATE "towbar_deployments" AS "deployment"
SET "server_id" = "mapping"."new_server_id"
FROM "towbar_server_source_migration" AS "mapping"
WHERE "mapping"."old_server_id" = "deployment"."server_id"
  AND "mapping"."source_id" = "deployment"."source_id";--> statement-breakpoint
DELETE FROM "towbar_servers" WHERE "source_id" IS NULL;--> statement-breakpoint
UPDATE "towbar_source_aws_credentials" AS "credential"
SET "source_id" = (
  SELECT "source"."id"
  FROM "towbar_sources" AS "source"
  WHERE "source"."workspace_id" = "credential"."workspace_id"
  ORDER BY "source"."created_at", "source"."id"
  LIMIT 1
);--> statement-breakpoint
DELETE FROM "towbar_source_aws_credentials" WHERE "source_id" IS NULL;--> statement-breakpoint
ALTER TABLE "towbar_servers" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_source_aws_credentials" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
DROP TABLE "towbar_source_server_declarations" CASCADE;--> statement-breakpoint
DROP TABLE "towbar_server_source_migration";--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD CONSTRAINT "towbar_servers_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_aws_credentials" ADD CONSTRAINT "towbar_source_aws_credentials_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_source_aws_credentials" ADD CONSTRAINT "towbar_source_aws_credentials_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_servers_source_ip" ON "towbar_servers" USING btree ("source_id","canonical_ip");--> statement-breakpoint
CREATE INDEX "idx_towbar_servers_workspace" ON "towbar_servers" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_aws_credentials_source" ON "towbar_source_aws_credentials" USING btree ("source_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_aws_credentials_workspace" ON "towbar_source_aws_credentials" USING btree ("workspace_id");
