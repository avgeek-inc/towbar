CREATE TABLE "towbar_analytics_samples" (
  "server_id" uuid NOT NULL REFERENCES "towbar_servers"("id") ON DELETE CASCADE,
  "sample_id" varchar(32) NOT NULL,
  "app_id" uuid NOT NULL REFERENCES "towbar_apps"("id") ON DELETE CASCADE,
  "collected_at" timestamptz NOT NULL,
  "cells" jsonb NOT NULL,
  "coverage" jsonb,
  PRIMARY KEY ("server_id", "sample_id", "app_id")
);
--> statement-breakpoint
CREATE INDEX "towbar_analytics_app_time" ON "towbar_analytics_samples" ("app_id", "collected_at");
--> statement-breakpoint
CREATE INDEX "towbar_analytics_age" ON "towbar_analytics_samples" ("collected_at");
--> statement-breakpoint
CREATE TABLE "towbar_analytics_refresh" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL CHECK ("id" = 1),
  "requested_at" timestamptz DEFAULT now() NOT NULL
);
