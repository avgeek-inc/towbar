CREATE TABLE "towbar_upgrade_admission" (
  "id" integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  "job_id" uuid
);
INSERT INTO "towbar_upgrade_admission" (id) VALUES (1);
CREATE TABLE "towbar_upgrade_leases" (
  "id" uuid PRIMARY KEY,
  "kind" varchar(120) NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Every admission and activity start shares this row lock. The host takes an
-- exclusive lock, persists the pause, then reads blockers in a NEW statement
-- (READ COMMITTED), including admissions that committed while it waited.
CREATE FUNCTION public.towbar_check_upgrade_admission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE paused uuid; next_state text;
BEGIN
  SELECT job_id INTO paused FROM public.towbar_upgrade_admission WHERE id = 1 FOR SHARE;
  IF FOUND AND paused IS NOT NULL AND TG_OP = 'UPDATE' THEN
    next_state := coalesce(to_jsonb(NEW)->>'state', to_jsonb(NEW)->>'status');
    -- Finishing existing work (including an operator resolving an interrupted
    -- record) is safe. Starting/requeueing and all inserts remain blocked.
    IF next_state IN ('succeeded','succeeded_with_warnings','skipped','failed','cancelled','clean','findings','deleted','healthy') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT FOUND OR paused IS NOT NULL THEN
    RAISE EXCEPTION 'Towbar upgrade admission is paused' USING ERRCODE = 'TB001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
DO $$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY[
    'towbar_deployments', 'towbar_source_syncs', 'towbar_resource_operations',
    'towbar_server_checks', 'towbar_server_preparations',
    'towbar_server_credential_verifications', 'towbar_image_vulnerability_scans',
    'towbar_preview_environments', 'towbar_upgrade_leases'
  ] LOOP
    EXECUTE format('CREATE TRIGGER towbar_upgrade_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.towbar_check_upgrade_admission()', target);
  END LOOP;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'towbar_app') THEN
    REVOKE INSERT, UPDATE, DELETE ON public.towbar_upgrade_admission FROM towbar_app;
    GRANT SELECT ON public.towbar_upgrade_admission TO towbar_app;
  END IF;
END $$;
--> statement-breakpoint
CREATE VIEW public.towbar_upgrade_blockers AS
SELECT 'Deployments' AS label, count(*) AS count FROM public.towbar_deployments WHERE state NOT IN ('succeeded','succeeded_with_warnings','skipped','failed','cancelled')
UNION ALL SELECT 'Source syncs', count(*) FROM public.towbar_source_syncs WHERE status IN ('queued','running')
UNION ALL SELECT 'Resource operations', count(*) FROM public.towbar_resource_operations WHERE state IN ('queued','running')
UNION ALL SELECT 'Server checks', count(*) FROM public.towbar_server_checks WHERE status IN ('queued','running')
UNION ALL SELECT 'Server preparations', count(*) FROM public.towbar_server_preparations WHERE status IN ('queued','running')
UNION ALL SELECT 'Credential checks', count(*) FROM public.towbar_server_credential_verifications WHERE status IN ('queued','running')
UNION ALL SELECT 'Image scans', count(*) FROM public.towbar_image_vulnerability_scans WHERE state IN ('pending','running')
UNION ALL SELECT 'Preview cleanup', count(*) FROM public.towbar_preview_environments WHERE status IN ('deleting','cleanup_failed')
UNION ALL SELECT 'Active or interrupted activities and terminals', count(*) FROM public.towbar_upgrade_leases;
