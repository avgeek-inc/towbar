ALTER TABLE "towbar_scout_alert_incidents" ADD COLUMN "environment" varchar(20);--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_incidents" ADD COLUMN "rule_revision" timestamp with time zone;--> statement-breakpoint
-- Backfill only when the rule has not changed since the incident opened.
-- Unknown historical context stays null rather than selecting the wrong environment or endpoint.
UPDATE towbar_scout_alert_incidents i
SET environment=r.environment, rule_revision=r.updated_at
FROM towbar_scout_alert_rules r
WHERE r.id=i.rule_id AND r.updated_at<=i.opened_at;
