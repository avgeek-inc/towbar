ALTER TABLE "towbar_scout_alert_rules" DROP CONSTRAINT "towbar_scout_rule_repeat";--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" DROP COLUMN "destination_ids";--> statement-breakpoint
ALTER TABLE "towbar_scout_alert_rules" DROP COLUMN "repeat_seconds";--> statement-breakpoint
UPDATE "towbar_scout_alert_rules" SET "condition" = "condition" - 'recoveryThreshold' - 'recoverySeconds';--> statement-breakpoint
UPDATE "towbar_scout_alert_incidents" SET "condition" = "condition" - 'recoveryThreshold' - 'recoverySeconds';--> statement-breakpoint
UPDATE "towbar_notification_destinations" SET "enabled" = true, "categories" = '["scout"]'::jsonb WHERE "server_id" IS NOT NULL AND "deleted_at" IS NULL;
