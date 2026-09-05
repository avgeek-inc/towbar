CREATE TABLE "towbar_server_deployable_ownership" (
	"server_id" uuid NOT NULL,
	"deployable_id" uuid NOT NULL,
	CONSTRAINT "towbar_server_deployable_ownership_server_id_deployable_id_pk" PRIMARY KEY("server_id","deployable_id")
);
--> statement-breakpoint
ALTER TABLE "towbar_server_deployable_ownership" ADD CONSTRAINT "towbar_server_deployable_ownership_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Retain ownership independently of the imported inventory. Historical checks
-- recover previously deleted workloads without adopting arbitrary Docker labels.
INSERT INTO towbar_server_deployable_ownership (server_id, deployable_id)
SELECT server_id, id FROM towbar_apps
UNION
SELECT c.server_id, (r.item->>'deployableId')::uuid
FROM towbar_server_checks c
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(c.result->'runtime') = 'array' THEN c.result->'runtime' ELSE '[]'::jsonb END
) AS r(item)
WHERE r.item->>'deployableId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
CREATE FUNCTION towbar_record_deployable_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO towbar_server_deployable_ownership (server_id, deployable_id)
  VALUES (NEW.server_id, NEW.id) ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER towbar_record_deployable_ownership
AFTER INSERT OR UPDATE OF server_id ON towbar_apps
FOR EACH ROW EXECUTE FUNCTION towbar_record_deployable_ownership();
--> statement-breakpoint
-- Serialize new workload/operation admission against removal. A server row
-- stays for history, so a foreign key alone cannot prevent post-removal work.
CREATE FUNCTION towbar_require_active_server() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.server_id IS NULL THEN RETURN NEW; END IF;
  PERFORM id FROM towbar_servers WHERE id = NEW.server_id AND archived_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Server is not registered' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT OR UPDATE OF server_id, archived_at ON towbar_apps
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_server_checks
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_server_preparations
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_deployments
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_resource_operations
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_image_vulnerability_scans
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT ON towbar_preview_environments
FOR EACH ROW EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT OR UPDATE ON towbar_managed_secrets
FOR EACH ROW WHEN (NEW.server_id IS NOT NULL) EXECUTE FUNCTION towbar_require_active_server();
--> statement-breakpoint
CREATE TRIGGER towbar_require_active_server BEFORE INSERT OR UPDATE ON towbar_ssh_host_keys
FOR EACH ROW WHEN (NEW.revoked_at IS NULL) EXECUTE FUNCTION towbar_require_active_server();
