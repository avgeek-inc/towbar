CREATE TABLE "towbar_auth_recovery_codes" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "towbar_users"("id") ON DELETE CASCADE,
  "code_hashes" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DELETE FROM "towbar_sessions" WHERE "user_id" IN (
  SELECT "id" FROM "towbar_users" WHERE "two_factor_enabled" OR EXISTS (
    SELECT 1 FROM "towbar_auth_passkeys" WHERE "user_id" = "towbar_users"."id"
  )
);
--> statement-breakpoint
UPDATE "towbar_users" SET "two_factor_enabled" = EXISTS (
  SELECT 1 FROM "towbar_auth_passkeys" WHERE "user_id" = "towbar_users"."id"
);
--> statement-breakpoint
DROP TABLE "towbar_auth_two_factors";
