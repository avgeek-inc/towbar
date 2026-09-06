CREATE TABLE "towbar_scout_http_checks" (
	"rule_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone,
	"rule_revision" timestamp with time zone NOT NULL,
	"state" varchar(20) DEFAULT 'pending' NOT NULL,
	"status_code" integer,
	"latency_ms" integer,
	"reason" varchar(240),
	CONSTRAINT "towbar_scout_http_checks_rule_id_scheduled_at_pk" PRIMARY KEY("rule_id","scheduled_at"),
	CONSTRAINT "towbar_scout_http_state" CHECK ("towbar_scout_http_checks"."state" in ('pending','healthy','failed','blocked'))
);
--> statement-breakpoint
ALTER TABLE "towbar_scout_http_checks" ADD CONSTRAINT "towbar_scout_http_checks_rule_id_towbar_scout_alert_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."towbar_scout_alert_rules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "towbar_scout_http_retention" ON "towbar_scout_http_checks" USING btree ("scheduled_at");