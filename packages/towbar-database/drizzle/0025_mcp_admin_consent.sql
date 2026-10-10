ALTER TABLE "towbar_api_key_policies" DROP CONSTRAINT "towbar_api_policy_oauth";
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_policy_oauth" CHECK ("token_type" = 'api-key' OR ("scope" = 'personal' AND (NOT "include_admin" OR "access" = 'edit') AND "oauth_client_id" IS NOT NULL AND "oauth_resource" IS NOT NULL AND "oauth_client_trust" IN ('metadata-document', 'unverified')));
