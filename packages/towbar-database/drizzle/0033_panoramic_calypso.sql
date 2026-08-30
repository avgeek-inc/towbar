CREATE TYPE "public"."towbar_vulnerability_scan_state" AS ENUM('pending', 'running', 'clean', 'findings', 'failed');--> statement-breakpoint
CREATE TYPE "public"."towbar_vulnerability_severity" AS ENUM('critical', 'high', 'medium', 'low', 'unknown');--> statement-breakpoint
CREATE TABLE "towbar_image_vulnerability_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"advisory_id" varchar(160) NOT NULL,
	"severity" "towbar_vulnerability_severity" NOT NULL,
	"package_name" varchar(255) NOT NULL,
	"installed_version" varchar(255) NOT NULL,
	"fixed_version" varchar(255),
	"target" varchar(512) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_image_vulnerability_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"app_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"deployment_id" uuid NOT NULL,
	"image_digest" varchar(71) NOT NULL,
	"state" "towbar_vulnerability_scan_state" DEFAULT 'pending' NOT NULL,
	"cycle" integer DEFAULT 1 NOT NULL,
	"scanner_name" varchar(100),
	"scanner_version" varchar(100),
	"vulnerability_database_updated_at" timestamp with time zone,
	"severity_totals" jsonb NOT NULL,
	"findings_truncated" boolean DEFAULT false NOT NULL,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_notification_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"destination_id" uuid NOT NULL,
	"entity_kind" varchar(40) NOT NULL,
	"entity_id" varchar(255) NOT NULL,
	"creating_delivery_id" uuid,
	"provider_thread_id" varchar(100),
	"provider_message_id" varchar(100),
	"latest_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_findings" ADD CONSTRAINT "towbar_image_vulnerability_findings_scan_id_towbar_image_vulnerability_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."towbar_image_vulnerability_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_source_id_towbar_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."towbar_sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_app_id_towbar_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."towbar_apps"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_image_vulnerability_scans" ADD CONSTRAINT "towbar_image_vulnerability_scans_deployment_id_towbar_deployments_id_fk" FOREIGN KEY ("deployment_id") REFERENCES "public"."towbar_deployments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_threads" ADD CONSTRAINT "towbar_notification_threads_destination_id_towbar_notification_destinations_id_fk" FOREIGN KEY ("destination_id") REFERENCES "public"."towbar_notification_destinations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_notification_threads" ADD CONSTRAINT "towbar_notification_threads_creating_delivery_id_towbar_notification_deliveries_id_fk" FOREIGN KEY ("creating_delivery_id") REFERENCES "public"."towbar_notification_deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_vulnerability_findings_scan_severity" ON "towbar_image_vulnerability_findings" USING btree ("scan_id","severity");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_vulnerability_scans_workspace_digest" ON "towbar_image_vulnerability_scans" USING btree ("workspace_id","image_digest");--> statement-breakpoint
CREATE INDEX "idx_towbar_vulnerability_scans_state_requested" ON "towbar_image_vulnerability_scans" USING btree ("state","requested_at");--> statement-breakpoint
CREATE INDEX "idx_towbar_vulnerability_scans_deployment" ON "towbar_image_vulnerability_scans" USING btree ("deployment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_notification_threads_destination_entity" ON "towbar_notification_threads" USING btree ("destination_id","entity_kind","entity_id");--> statement-breakpoint
CREATE INDEX "idx_towbar_notification_threads_destination" ON "towbar_notification_threads" USING btree ("destination_id");