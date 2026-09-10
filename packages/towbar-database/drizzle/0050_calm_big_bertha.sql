CREATE TABLE "towbar_workspace_azure_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"tenant_id" varchar(64) NOT NULL,
	"client_id" varchar(64) NOT NULL,
	"client_secret_suffix" varchar(8) NOT NULL,
	"verification_status" "towbar_credential_verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_message" varchar(500),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_workspace_gcp_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"encrypted_payload" jsonb NOT NULL,
	"project_id" varchar(128) NOT NULL,
	"client_email" varchar(256) NOT NULL,
	"verification_status" "towbar_credential_verification_status" DEFAULT 'unverified' NOT NULL,
	"verification_message" varchar(500),
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_workspace_azure_credentials" ADD CONSTRAINT "towbar_workspace_azure_credentials_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_workspace_gcp_credentials" ADD CONSTRAINT "towbar_workspace_gcp_credentials_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_azure_credentials_workspace" ON "towbar_workspace_azure_credentials" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_gcp_credentials_workspace" ON "towbar_workspace_gcp_credentials" USING btree ("workspace_id");