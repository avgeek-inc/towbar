DELETE FROM "towbar_image_vulnerability_scans"
WHERE "app_id" IN (SELECT "id" FROM "towbar_apps" WHERE "kind" = 'image');

DELETE FROM "towbar_releases"
WHERE "app_id" IN (SELECT "id" FROM "towbar_apps" WHERE "kind" = 'image');

DELETE FROM "towbar_deployments"
WHERE "app_id" IN (SELECT "id" FROM "towbar_apps" WHERE "kind" = 'image')
   OR "deployable_kind" = 'image';

DELETE FROM "towbar_apps" WHERE "kind" = 'image';
DELETE FROM "towbar_source_entities"
WHERE "entity_type" = 'resource' AND "resource_type" = 'image';

ALTER TABLE "towbar_source_entities"
DROP CONSTRAINT "towbar_source_entity_kind";
ALTER TABLE "towbar_source_entities"
ADD CONSTRAINT "towbar_source_entity_kind"
CHECK (
  ("entity_type" IN ('app', 'compose') AND "resource_type" IS NULL)
  OR ("entity_type" = 'resource' AND "resource_type" IN (
    'postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'dragonfly', 'keydb', 'clickhouse'
  ))
);

ALTER TABLE "towbar_apps" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "towbar_deployments" ALTER COLUMN "deployable_kind" DROP DEFAULT;
ALTER TYPE "towbar_deployable_kind" RENAME TO "towbar_deployable_kind_old";
CREATE TYPE "towbar_deployable_kind" AS ENUM (
  'app', 'compose', 'postgres', 'mysql', 'mariadb', 'mongodb', 'redis',
  'dragonfly', 'keydb', 'clickhouse'
);
ALTER TABLE "towbar_apps" ALTER COLUMN "kind" TYPE "towbar_deployable_kind"
USING "kind"::text::"towbar_deployable_kind";
ALTER TABLE "towbar_deployments" ALTER COLUMN "deployable_kind" TYPE "towbar_deployable_kind"
USING "deployable_kind"::text::"towbar_deployable_kind";
ALTER TABLE "towbar_apps" ALTER COLUMN "kind" SET DEFAULT 'app';
ALTER TABLE "towbar_deployments" ALTER COLUMN "deployable_kind" SET DEFAULT 'app';
DROP TYPE "towbar_deployable_kind_old";
