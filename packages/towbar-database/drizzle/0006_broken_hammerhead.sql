CREATE TABLE "towbar_notification_telegram_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"chat_id" varchar(21) NOT NULL,
	"message_thread_id" integer DEFAULT 0 NOT NULL,
	"legacy_route_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deployments" boolean DEFAULT false NOT NULL,
	"backups_and_restores" boolean DEFAULT false NOT NULL,
	"alerts_and_incidents" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_telegram_routing" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"migrated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_notification_telegram_destinations" ADD CONSTRAINT "towbar_notification_telegram_destinations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_telegram_routing" ADD CONSTRAINT "towbar_notification_telegram_routing_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_telegram_destination" ON "towbar_notification_telegram_destinations" USING btree ("workspace_id","chat_id","message_thread_id");