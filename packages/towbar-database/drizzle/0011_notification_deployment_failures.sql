ALTER TABLE "towbar_notification_email_destinations" ADD COLUMN "deployment_failures" boolean DEFAULT false NOT NULL;
ALTER TABLE "towbar_notification_slack_destinations" ADD COLUMN "deployment_failures" boolean DEFAULT false NOT NULL;
ALTER TABLE "towbar_notification_telegram_destinations" ADD COLUMN "deployment_failures" boolean DEFAULT false NOT NULL;
ALTER TABLE "towbar_notification_discord_route_settings" ADD COLUMN "deployment_failures" boolean DEFAULT false NOT NULL;
ALTER TABLE "towbar_notification_webhook_route_settings" ADD COLUMN "deployment_failures" boolean DEFAULT false NOT NULL;
