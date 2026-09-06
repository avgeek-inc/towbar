CREATE TABLE "towbar_monitoring_agents" (
	"server_id" uuid PRIMARY KEY NOT NULL,
	"retention_days" integer DEFAULT 15 NOT NULL,
	"desired_state" varchar(20) DEFAULT 'disabled' NOT NULL,
	"status" varchar(20) DEFAULT 'disabled' NOT NULL,
	"generation" uuid DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" varchar(64),
	"encrypted_token" jsonb,
	"installed_version" varchar(64),
	"last_report_at" timestamp with time zone,
	"last_collected_at" timestamp with time zone,
	"diagnostics" jsonb,
	"error_message" text,
	"operation_started_at" timestamp with time zone,
	"requested_by" uuid,
	"ingest_window" timestamp with time zone,
	"ingest_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_monitoring_retention" CHECK ("towbar_monitoring_agents"."retention_days" in (7,15,30,60)),
	CONSTRAINT "towbar_monitoring_desired_state" CHECK ("towbar_monitoring_agents"."desired_state" in ('enabled','disabled')),
	CONSTRAINT "towbar_monitoring_status" CHECK ("towbar_monitoring_agents"."status" in ('disabled','queued','installing','waiting','online','uninstalling','failed'))
);
--> statement-breakpoint
CREATE TABLE "towbar_monitoring_batches" (
	"server_id" uuid NOT NULL,
	"sample_id" varchar(32) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "towbar_monitoring_batches_server_id_sample_id_pk" PRIMARY KEY("server_id","sample_id")
);
--> statement-breakpoint
CREATE TABLE "towbar_monitoring_samples" (
	"server_id" uuid NOT NULL,
	"entity_id" varchar(64) NOT NULL,
	"bucket_at" timestamp with time zone NOT NULL,
	"resolution" integer DEFAULT 30 NOT NULL,
	"deployable_id" uuid,
	"deployment_id" uuid,
	"preview_id" uuid,
	"state" varchar(20),
	"health" varchar(20),
	"metrics" jsonb NOT NULL,
	CONSTRAINT "towbar_monitoring_samples_server_id_entity_id_bucket_at_resolution_pk" PRIMARY KEY("server_id","entity_id","bucket_at","resolution"),
	CONSTRAINT "towbar_monitoring_resolution" CHECK ("towbar_monitoring_samples"."resolution" in (30,60))
);
--> statement-breakpoint
ALTER TABLE "towbar_monitoring_agents" ADD CONSTRAINT "towbar_monitoring_agents_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_agents" ADD CONSTRAINT "towbar_monitoring_agents_requested_by_towbar_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."towbar_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_batches" ADD CONSTRAINT "towbar_monitoring_batches_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "towbar_monitoring_samples" ADD CONSTRAINT "towbar_monitoring_samples_server_id_towbar_servers_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."towbar_servers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "towbar_monitoring_batch_age" ON "towbar_monitoring_batches" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "towbar_monitoring_server_time" ON "towbar_monitoring_samples" USING btree ("server_id","bucket_at");--> statement-breakpoint
CREATE INDEX "towbar_monitoring_workload_time" ON "towbar_monitoring_samples" USING btree ("deployable_id","bucket_at");--> statement-breakpoint
CREATE INDEX "towbar_monitoring_rollup" ON "towbar_monitoring_samples" USING btree ("resolution","bucket_at");--> statement-breakpoint
CREATE FUNCTION towbar_merge_monitoring_metrics(a jsonb, b jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(jsonb_object_agg(key, jsonb_build_object('sum', total, 'min', minimum, 'max', maximum, 'count', samples)), '{}'::jsonb)
  FROM (
    SELECT key, sum((value->>'sum')::double precision) total,
      min((value->>'min')::double precision) minimum,
      max((value->>'max')::double precision) maximum,
      sum((value->>'count')::integer) samples
    FROM (SELECT * FROM jsonb_each(a) UNION ALL SELECT * FROM jsonb_each(b)) entries
    GROUP BY key
  ) merged
$$;
--> statement-breakpoint
CREATE TRIGGER towbar_monitoring_require_active_server
BEFORE INSERT OR UPDATE ON towbar_monitoring_agents
FOR EACH ROW WHEN (NEW.desired_state = 'enabled') EXECUTE FUNCTION towbar_require_active_server();
