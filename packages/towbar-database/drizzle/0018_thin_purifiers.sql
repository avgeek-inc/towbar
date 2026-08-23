CREATE TABLE "towbar_server_preparations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"server_id" uuid NOT NULL,
	"config_digest" varchar(64) NOT NULL,
	"status" "towbar_check_status" DEFAULT 'queued' NOT NULL,
	"steps" jsonb NOT NULL,
	"result" jsonb,
	"error_code" varchar(100),
	"error_message" varchar(1000),
	"requested_by" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD COLUMN "prepared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "towbar_servers" ADD COLUMN "prepared_config_digest" varchar(64);--> statement-breakpoint
ALTER TABLE "towbar_server_preparations" ADD CONSTRAINT "towbar_server_preparations_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_server_preparations" ADD CONSTRAINT "towbar_server_preparations_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_towbar_server_preparations_server_created" ON "towbar_server_preparations" USING btree ("server_id","created_at");