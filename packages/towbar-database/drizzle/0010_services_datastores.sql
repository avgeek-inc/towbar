CREATE FUNCTION pg_temp.towbar_image_as_service(value jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  container jsonb := value->'container';
  health jsonb := value->'health';
  deployment jsonb;
BEGIN
  IF value->>'kind' IS DISTINCT FROM 'image' THEN
    RETURN value;
  END IF;
  IF container->>'port' IS NULL
     OR jsonb_array_length(COALESCE(container->'command', '[]'::jsonb)) > 0
     OR (health->>'type' IS NOT NULL AND health->>'type' <> 'http')
     OR value->'access' IS NOT NULL
     OR value->'backup' IS NOT NULL THEN
    RAISE EXCEPTION 'Image workload % needs its custom runtime settings converted to a service before upgrading. No workload data has been removed.', value->>'id';
  END IF;
  deployment := jsonb_build_object(
    'type', 'image', 'image', value->>'image', 'pullPolicy', 'if-not-present'
  );
  IF value->'registry' IS NOT NULL THEN
    deployment := deployment || jsonb_build_object('registry', value->'registry');
  END IF;
  container := container - 'command';
  IF container->'volumes' = '[]'::jsonb THEN
    container := container - 'volumes';
  END IF;
  health := CASE WHEN health->>'path' IS NOT NULL THEN health - 'type'
    ELSE jsonb_build_object('path', '/', 'timeoutSeconds', 60) END;
  RETURN (value - 'image' - 'registry') || jsonb_build_object(
    'kind', 'app', 'deployment', deployment, 'container', container,
    'health', health, 'context', '.', 'hooks', '{}'::jsonb,
    'vulnerabilityScanning', false, 'deploymentInputs', '[]'::jsonb,
    'rollout', jsonb_build_object(
      'type', 'recreate', 'maintenanceMode', true, 'terminationSeconds', 30,
      'reason', 'Keep the existing single-container deployment'
    )
  );
END $$;

UPDATE "towbar_source_entities"
SET "entity_type" = 'app', "resource_type" = NULL
WHERE "entity_type" = 'resource' AND "resource_type" = 'image';

UPDATE "towbar_apps"
SET "kind" = 'app', "config" = pg_temp.towbar_image_as_service("config")
WHERE "kind" = 'image';

UPDATE "towbar_deployments"
SET "deployable_kind" = 'app',
    "app_snapshot" = pg_temp.towbar_image_as_service("app_snapshot")
WHERE "deployable_kind" = 'image';

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
