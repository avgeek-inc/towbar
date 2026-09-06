ALTER TABLE "towbar_notification_destinations" ALTER COLUMN "source_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ALTER COLUMN "source_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "towbar_notification_destinations" ADD COLUMN "server_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD COLUMN "server_id" uuid;--> statement-breakpoint
ALTER TABLE "towbar_notification_destinations" ADD CONSTRAINT "towbar_notification_destinations_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD CONSTRAINT "towbar_notification_events_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notificationDestinations_server" ON "towbar_notification_destinations" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "notificationEvents_server" ON "towbar_notification_events" USING btree ("server_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_events_server_dedupe" ON "towbar_notification_events" USING btree ("server_id","dedupe_key");--> statement-breakpoint
ALTER TABLE "towbar_notification_destinations" ADD CONSTRAINT "notificationDestinations_scope" CHECK (num_nonnulls("towbar_notification_destinations"."source_id", "towbar_notification_destinations"."server_id") = 1);--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD CONSTRAINT "notificationEvents_scope" CHECK (num_nonnulls("towbar_notification_events"."source_id", "towbar_notification_events"."server_id") = 1);