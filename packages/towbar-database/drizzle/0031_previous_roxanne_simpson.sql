CREATE TYPE "public"."towbar_backup_assurance_status" AS ENUM('missing', 'stale', 'not_restore_ready', 'restore_ready');--> statement-breakpoint
ALTER TYPE "public"."towbar_resource_operation_state" ADD VALUE 'cancelled';--> statement-breakpoint
ALTER TYPE "public"."towbar_resource_operation_type" ADD VALUE 'restore_cleanup' BEFORE 'start';--> statement-breakpoint
CREATE TABLE "towbar_resource_backup_assurances" (
	"resource_id" uuid NOT NULL,
	"backup_operation_id" uuid PRIMARY KEY NOT NULL,
	"status" "towbar_backup_assurance_status" NOT NULL,
	"restore_ready" boolean DEFAULT false NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_resource_operation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"phase" varchar(64) NOT NULL,
	"level" varchar(16) DEFAULT 'info' NOT NULL,
	"message" varchar(1000) NOT NULL,
	"command" varchar(1000),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD COLUMN "phase" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_resource_operations" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "towbar_resource_backup_assurances" ADD CONSTRAINT "towbar_resource_backup_assurances_resource_id_towbar_apps_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_backup_assurances" ADD CONSTRAINT "towbar_resource_backup_assurances_backup_operation_id_towbar_resource_operations_id_fk" FOREIGN KEY ("backup_operation_id") REFERENCES "public"."towbar_resource_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_resource_operation_events" ADD CONSTRAINT "towbar_resource_operation_events_operation_id_towbar_resource_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."towbar_resource_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_backup_assurances_status" ON "towbar_resource_backup_assurances" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_towbar_backup_assurances_resource" ON "towbar_resource_backup_assurances" USING btree ("resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_resource_operation_events_sequence" ON "towbar_resource_operation_events" USING btree ("operation_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_towbar_resource_operation_events_created" ON "towbar_resource_operation_events" USING btree ("operation_id","created_at");
