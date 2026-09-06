CREATE TABLE "towbar_scout_alert_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rule_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"deployable_id" uuid,
	"rule_name" varchar(100) NOT NULL,
	"severity" varchar(20) NOT NULL,
	"condition" jsonb NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"condition_started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_reason" varchar(80),
	"last_value" jsonb,
	"last_notified_at" timestamp with time zone,
	"notification_sequence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "towbar_scout_alert_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"server_id" uuid NOT NULL,
	"deployable_id" uuid,
	"name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"severity" varchar(20) DEFAULT 'warning' NOT NULL,
	"environment" varchar(20) DEFAULT 'production' NOT NULL,
	"condition" jsonb NOT NULL,
	"destination_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notify_recovery" boolean DEFAULT true NOT NULL,
	"repeat_seconds" integer DEFAULT 0 NOT NULL,
	"muted_until" timestamp with time zone,
	"mute_reason" varchar(240) DEFAULT '' NOT NULL,
	"evaluation_state" varchar(20) DEFAULT 'unknown' NOT NULL,
	"evaluated_at" timestamp with time zone,
	"observed_value" jsonb,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_scout_rule_environment" CHECK ("towbar_scout_alert_rules"."environment" in ('production','preview')),
	CONSTRAINT "towbar_scout_rule_severity" CHECK ("towbar_scout_alert_rules"."severity" in ('warning','critical')),
	CONSTRAINT "towbar_scout_rule_repeat" CHECK ("towbar_scout_alert_rules"."repeat_seconds"=0 or "towbar_scout_alert_rules"."repeat_seconds" between 900 and 86400)
);
--> statement-breakpoint
CREATE TABLE "towbar_scout_alert_settings" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"muted_until" timestamp with time zone,
	"mute_reason" varchar(240) DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_incidents" ADD CONSTRAINT "towbar_scout_alert_incidents_rule_id_towbar_scout_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."towbar_scout_alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_incidents" ADD CONSTRAINT "towbar_scout_alert_incidents_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_incidents" ADD CONSTRAINT "towbar_scout_alert_incidents_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" ADD CONSTRAINT "towbar_scout_alert_rules_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" ADD CONSTRAINT "towbar_scout_alert_rules_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" ADD CONSTRAINT "towbar_scout_alert_rules_deployable_id_towbar_apps_id_fk" FOREIGN KEY ("deployable_id") REFERENCES "public"."towbar_apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_settings" ADD CONSTRAINT "towbar_scout_alert_settings_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "towbar_scout_one_active_incident" ON "towbar_scout_alert_incidents" USING btree ("rule_id") WHERE "towbar_scout_alert_incidents"."resolved_at" is null;--> statement-breakpoint
CREATE INDEX "towbar_scout_incidents_history" ON "towbar_scout_alert_incidents" USING btree ("workspace_id","server_id","opened_at","id");--> statement-breakpoint
CREATE INDEX "towbar_scout_rules_due" ON "towbar_scout_alert_rules" USING btree ("evaluated_at") WHERE "towbar_scout_alert_rules"."enabled" and "towbar_scout_alert_rules"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "towbar_scout_rules_server" ON "towbar_scout_alert_rules" USING btree ("workspace_id","server_id");