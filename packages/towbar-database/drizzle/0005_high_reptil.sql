CREATE TABLE "towbar_notification_discord_route_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"route_id" varchar(255) NOT NULL,
	"deployments" boolean DEFAULT false NOT NULL,
	"backups_and_restores" boolean DEFAULT false NOT NULL,
	"alerts_and_incidents" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_notification_discord_route_settings" ADD CONSTRAINT "towbar_notification_discord_route_settings_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_discord_route_setting" ON "towbar_notification_discord_route_settings" USING btree ("workspace_id","route_id");
