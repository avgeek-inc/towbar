DO $$
DECLARE
  conflicts text;
BEGIN
  SELECT string_agg(format('%s/%s (source %s), id %s, image entity %s',
    source.repository_owner, source.repository_name, image.source_id,
    image.manifest_id, image.id), E'\n' ORDER BY image.source_id, image.manifest_id)
  INTO conflicts
  FROM "towbar_source_entities" image
  JOIN "towbar_source_entities" app
    ON app.source_id = image.source_id AND app.manifest_id = image.manifest_id
    AND app.entity_type = 'app'
  JOIN "towbar_sources" source ON source.id = image.source_id
  WHERE image.entity_type = 'resource' AND image.resource_type = 'image';
  IF conflicts IS NOT NULL THEN
    RAISE EXCEPTION 'Image workloads share IDs with apps. Rename the conflicting workload before upgrading. No workload data has been changed.'
      USING DETAIL = conflicts,
        HINT = 'Follow https://www.towbar.dev/docs/self-hosting/upgrades#resolve-a-legacy-image-id-conflict to rename the existing records and repository manifest together.';
  END IF;
END $$;

CREATE FUNCTION pg_temp.towbar_image_as_service(value jsonb) RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  container jsonb := value->'container';
  health jsonb := value->'health';
  deployment jsonb;
  volumes jsonb := COALESCE(container->'volumes', '[]'::jsonb);
  volume jsonb;
  mount_path text;
BEGIN
  IF value->>'kind' IS DISTINCT FROM 'image' THEN
    RETURN value;
  END IF;
  FOR volume IN SELECT item FROM jsonb_array_elements(volumes) AS entries(item) LOOP
    mount_path := volume->>'mountPath';
    IF mount_path IS NULL
       OR length(mount_path) > 1024
       OR mount_path !~ '^/[a-zA-Z0-9_./-]+$'
       OR mount_path ~ '/$|//|/\.(\.?)(/|$)'
       OR mount_path ~ '^/(proc|sys|dev|etc|run|var/run)(/|$)' THEN
      RAISE EXCEPTION 'Image workload % has a service-incompatible volume mount: %. No workload data has been changed.', value->>'id', mount_path
        USING HINT = 'Use a canonical application data path such as /data or /app/uploads. Keep the volume name and migrate its contents before changing the mount. See https://www.towbar.dev/docs/self-hosting/upgrades#legacy-image-volume-settings.';
    END IF;
  END LOOP;
  IF jsonb_array_length(volumes) > 20 OR EXISTS (
    SELECT 1
    FROM jsonb_array_elements(volumes) WITH ORDINALITY AS first_volume(item, position)
    JOIN jsonb_array_elements(volumes) WITH ORDINALITY AS second_volume(item, position)
      ON first_volume.position < second_volume.position
    WHERE first_volume.item->>'name' = second_volume.item->>'name'
       OR first_volume.item->>'mountPath' = second_volume.item->>'mountPath'
       OR starts_with(first_volume.item->>'mountPath', (second_volume.item->>'mountPath') || '/')
       OR starts_with(second_volume.item->>'mountPath', (first_volume.item->>'mountPath') || '/')
  ) THEN
    RAISE EXCEPTION 'Image workload % needs at most 20 uniquely named volumes with non-overlapping mount paths. No workload data has been changed.', value->>'id'
      USING HINT = 'Review the existing volumes before upgrading. See https://www.towbar.dev/docs/self-hosting/upgrades#legacy-image-volume-settings.';
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
