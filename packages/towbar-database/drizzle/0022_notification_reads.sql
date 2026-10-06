CREATE TABLE "towbar_notification_reads" (
  "workspace_id" uuid NOT NULL REFERENCES "towbar_workspaces"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "towbar_users"("id") ON DELETE CASCADE,
  "event_id" uuid NOT NULL REFERENCES "towbar_notification_events"("id") ON DELETE CASCADE,
  "read_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("workspace_id", "user_id", "event_id")
);
--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_events_workspace_occurred" ON "towbar_notification_events" ("workspace_id", "occurred_at" DESC, "id" DESC);
