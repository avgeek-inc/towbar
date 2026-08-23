DROP TABLE "towbar_app_authority_approvals";--> statement-breakpoint
ALTER TABLE "towbar_terminal_sessions" RENAME COLUMN "authority_digest" TO "target_digest";
