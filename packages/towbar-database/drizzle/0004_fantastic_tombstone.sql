CREATE TABLE "towbar_app_authority_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"authority_digest" varchar(64) NOT NULL,
	"authority" jsonb NOT NULL,
	"approved_by" uuid NOT NULL,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_app_authority_approvals" ADD CONSTRAINT "towbar_app_authority_approvals_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_app_authority_approvals" ADD CONSTRAINT "towbar_app_authority_approvals_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_app_authority_approvals" ADD CONSTRAINT "towbar_app_authority_approvals_approved_by_towbar_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."towbar_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_app_authority_approval" ON "towbar_app_authority_approvals" USING btree ("app_id","authority_digest");--> statement-breakpoint
CREATE INDEX "idx_towbar_app_authority_approval_latest" ON "towbar_app_authority_approvals" USING btree ("app_id","approved_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_app_authority_approval_workspace" ON "towbar_app_authority_approvals" USING btree ("workspace_id");