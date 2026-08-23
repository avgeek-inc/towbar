DROP TABLE "towbar_auth_codes" CASCADE;--> statement-breakpoint
DROP TABLE "towbar_password_reset_tokens" CASCADE;--> statement-breakpoint
ALTER TABLE "towbar_password_credentials" ADD COLUMN "operator_reset_fingerprint" varchar(64);