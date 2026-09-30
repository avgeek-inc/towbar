ALTER TABLE "towbar_api_key_policies" ADD COLUMN "permission_mode" text DEFAULT 'scoped' NOT NULL;
--> statement-breakpoint
-- The 33-action ceiling was unchanged from v2.0.0 until host log collection.
-- Preserve narrowed/versioned policies; recognize only complete known snapshots.
WITH historical AS (
  SELECT '["identity.read","repository.read","repository.connect","repository.update","repository.sync","repository.disconnect","deployment.read","deployment.create","deployment.cancel","workload.read","workload.operate","resource.read","resource.backup","resource.restore","server.read","server.prepare","server.update","server.credentials","server.remove","secret.list","secret.update","sharedSecret.list","sharedSecret.update","sharedSecret.reference","scout.read","scout.configure","alert.read","alert.configure","integration.manage","githubInstallation.read","notification.manage","system.read","system.manage"]'::jsonb AS grants
)
UPDATE "towbar_api_key_policies" AS p
SET "permission_mode" = 'full-admin', "version" = p."version" + 1
FROM historical, "towbar_api_keys" AS k
WHERE k."id" = p."key_id"
  AND k."config_id" = p."scope"
  AND k."enabled" = true
  AND (k."expires_at" IS NULL OR k."expires_at" > now())
  AND p."revoked_at" IS NULL
  AND p."token_type" = 'api-key'
  AND p."access" = 'edit'
  AND p."include_admin" = true
  AND p."version" = 1
  AND p."grants" @> historical.grants
  AND p."grants" <@ (historical.grants || '["server.collectLogs"]'::jsonb)
  AND (
    (p."scope" = 'team' AND k."reference_id" = p."workspace_id")
    OR (p."scope" = 'personal' AND k."reference_id" = p."owner_user_id" AND EXISTS (
      SELECT 1 FROM "towbar_workspace_members" AS m
      JOIN "towbar_users" AS u ON u."id" = m."user_id"
      WHERE m."workspace_id" = p."workspace_id" AND m."user_id" = p."owner_user_id"
        AND m."role" = 'admin' AND u."disabled_at" IS NULL AND NOT u."must_change_password"
    ))
  );
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_policy_permission_mode" CHECK ("permission_mode" = 'scoped' OR ("permission_mode" = 'full-admin' AND "token_type" = 'api-key' AND "access" = 'edit' AND "include_admin"));
