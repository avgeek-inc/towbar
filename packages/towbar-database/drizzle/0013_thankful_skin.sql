CREATE TYPE "public"."towbar_terminal_session_state" AS ENUM('pending', 'connecting', 'active', 'ended', 'failed');--> statement-breakpoint
CREATE TABLE "towbar_terminal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"release_id" uuid NOT NULL,
	"requested_by" uuid,
	"browser_session_id" uuid,
	"state" "towbar_terminal_session_state" DEFAULT 'pending' NOT NULL,
	"authority_digest" varchar(64) NOT NULL,
	"container_name" varchar(255) NOT NULL,
	"shell" varchar(255) NOT NULL,
	"app_snapshot" jsonb NOT NULL,
	"server_snapshot" jsonb NOT NULL,
	"error_message" varchar(1000),
	"exit_code" integer,
	"exit_signal" varchar(40),
	"expires_at" timestamp with time zone NOT NULL,
	"connected_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" ADD CONSTRAINT "towbar_terminal_sessions_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" ADD CONSTRAINT "towbar_terminal_sessions_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" ADD CONSTRAINT "towbar_terminal_sessions_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" ADD CONSTRAINT "towbar_terminal_sessions_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" ADD CONSTRAINT "towbar_terminal_sessions_release_id_towbar_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."towbar_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" ADD CONSTRAINT "towbar_terminal_sessions_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" ADD CONSTRAINT "towbar_terminal_sessions_browser_session_id_towbar_sessions_id_fk" FOREIGN KEY ("browser_session_id") REFERENCES "public"."towbar_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_terminal_sessions_app_created" ON "towbar_terminal_sessions" USING btree ("app_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_terminal_sessions_state_expires" ON "towbar_terminal_sessions" USING btree ("state","expires_at");