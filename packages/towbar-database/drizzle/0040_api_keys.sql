CREATE TABLE "towbar_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"access" varchar(10) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"token_prefix" varchar(20) NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_api_keys_access" CHECK ("towbar_api_keys"."access" in ('read', 'write'))
);
--> statement-breakpoint
ALTER TABLE "towbar_api_keys" ADD CONSTRAINT "towbar_api_keys_user_id_towbar_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."towbar_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_api_keys" ADD CONSTRAINT "towbar_api_keys_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_api_keys_hash" ON "towbar_api_keys" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_towbar_api_keys_owner" ON "towbar_api_keys" USING btree ("workspace_id","user_id");