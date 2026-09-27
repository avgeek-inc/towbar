CREATE TABLE "towbar_mcp_oauth_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"redirect_uris" jsonb NOT NULL,
	"secret_hash" text,
	"auth_method" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_mcp_oauth_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"client_logo" text,
	"client_trust" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"resource" text NOT NULL,
	"scope" text NOT NULL,
	"state" text,
	"challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_id" uuid,
	"workspace_id" uuid,
	"grants" jsonb,
	"code_hash" text,
	"consumed_at" timestamp with time zone,
	"key_id" uuid
);
--> statement-breakpoint
ALTER TABLE "towbar_mcp_oauth_requests" ADD CONSTRAINT "towbar_mcp_oauth_requests_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "towbar_mcp_oauth_requests" ADD CONSTRAINT "towbar_mcp_oauth_requests_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "towbar_mcp_oauth_requests" ADD CONSTRAINT "towbar_mcp_oauth_requests_key_id_towbar_api_keys_id_fk" FOREIGN KEY ("key_id") REFERENCES "public"."towbar_api_keys"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_mcp_oauth_code" ON "towbar_mcp_oauth_requests" USING btree ("code_hash");
--> statement-breakpoint
CREATE INDEX "idx_towbar_mcp_oauth_expiry" ON "towbar_mcp_oauth_requests" USING btree ("expires_at");
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD COLUMN "token_type" text DEFAULT 'api-key' NOT NULL;
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD COLUMN "oauth_client_id" text;
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD COLUMN "oauth_client_name" text;
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD COLUMN "oauth_client_logo" text;
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD COLUMN "oauth_client_trust" text;
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD COLUMN "oauth_resource" text;
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_policy_token_type" CHECK ("towbar_api_key_policies"."token_type" in ('api-key', 'mcp-oauth'));
--> statement-breakpoint
ALTER TABLE "towbar_api_key_policies" ADD CONSTRAINT "towbar_api_policy_oauth" CHECK ("towbar_api_key_policies"."token_type" = 'api-key' or ("towbar_api_key_policies"."scope" = 'personal' and not "towbar_api_key_policies"."include_admin" and "towbar_api_key_policies"."oauth_client_id" is not null and "towbar_api_key_policies"."oauth_resource" is not null and "towbar_api_key_policies"."oauth_client_trust" in ('metadata-document', 'unverified')));
