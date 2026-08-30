CREATE TYPE "public"."towbar_notification_attempt_state" AS ENUM('running', 'succeeded', 'retryable_failure', 'terminal_failure');--> statement-breakpoint
CREATE TYPE "public"."towbar_notification_delivery_state" AS ENUM('pending', 'delivering', 'retrying', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_notification_provider" AS ENUM('slack', 'smtp');--> statement-breakpoint
CREATE TABLE "towbar_notification_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"destination_id" uuid NOT NULL,
	"state" "towbar_notification_delivery_state" DEFAULT 'pending' NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" varchar(100),
	"last_error_message" varchar(1000),
	"last_attempted_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" uuid NOT NULL,
	"cycle" integer NOT NULL,
	"sequence" integer NOT NULL,
	"state" "towbar_notification_attempt_state" DEFAULT 'running' NOT NULL,
	"provider_status" varchar(100),
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_destinations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"provider" "towbar_notification_provider" NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"categories" jsonb NOT NULL,
	"config" jsonb NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"dedupe_key" varchar(512) NOT NULL,
	"type" varchar(80) NOT NULL,
	"category" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_notification_deliveries" ADD CONSTRAINT "towbar_notification_deliveries_event_id_towbar_notification_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."towbar_notification_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_deliveries" ADD CONSTRAINT "towbar_notification_deliveries_destination_id_towbar_notification_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."towbar_notification_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_delivery_attempts" ADD CONSTRAINT "towbar_notification_delivery_attempts_delivery_id_towbar_notification_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."towbar_notification_deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_destinations" ADD CONSTRAINT "towbar_notification_destinations_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_destinations" ADD CONSTRAINT "towbar_notification_destinations_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD CONSTRAINT "towbar_notification_events_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_events" ADD CONSTRAINT "towbar_notification_events_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_deliveries_event_destination" ON "towbar_notification_deliveries" USING btree ("event_id","destination_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_deliveries_state_next" ON "towbar_notification_deliveries" USING btree ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_deliveries_destination_created" ON "towbar_notification_deliveries" USING btree ("destination_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_attempts_identity" ON "towbar_notification_delivery_attempts" USING btree ("delivery_id","cycle","sequence");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_attempts_delivery" ON "towbar_notification_delivery_attempts" USING btree ("delivery_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_destinations_source_name" ON "towbar_notification_destinations" USING btree ("source_id","name") WHERE "towbar_notification_destinations"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_destinations_source" ON "towbar_notification_destinations" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_events_dedupe" ON "towbar_notification_events" USING btree ("source_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_events_source_created" ON "towbar_notification_events" USING btree ("source_id","created_at");
