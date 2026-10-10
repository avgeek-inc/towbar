CREATE TABLE "towbar_server_observations" (
  "server_id" uuid PRIMARY KEY REFERENCES "towbar_servers"("id") ON DELETE CASCADE,
  "hardware" jsonb,
  "hardware_at" timestamptz,
  "instance_at" timestamptz,
  "boot_id" uuid,
  "boot_observed_at" timestamptz
);
--> statement-breakpoint
CREATE TABLE "towbar_server_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "server_id" uuid NOT NULL REFERENCES "towbar_servers"("id") ON DELETE CASCADE,
  "at" timestamptz NOT NULL,
  "type" varchar(24) NOT NULL CONSTRAINT "towbar_server_event_type" CHECK ("type" IN ('host-restart','instance-change','capacity-change')),
  "detail" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "towbar_server_event_time" ON "towbar_server_events" ("server_id", "at");
