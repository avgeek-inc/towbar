CREATE TABLE "towbar_system_health_signals" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"workspace_id" uuid,
	"component" varchar(80) NOT NULL,
	"status" varchar(32) NOT NULL,
	"message" varchar(500) NOT NULL,
	"version" varchar(64),
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_system_health_signals" ADD CONSTRAINT "towbar_system_health_signals_workspace_id_towbar_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."towbar_workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_system_health_workspace" ON "towbar_system_health_signals" USING btree ("workspace_id","component");