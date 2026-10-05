ALTER TABLE "towbar_integration_installations" ADD COLUMN "principal_id" varchar(128);
--> statement-breakpoint
DROP INDEX "uq_towbar_integration_installation_workspace";
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_installation_workspace" ON "towbar_integration_installations" ("workspace_id", "provider") WHERE "provider" <> 'github';
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_integration_installation_account" ON "towbar_integration_installations" ("workspace_id", "provider", "principal_id");
