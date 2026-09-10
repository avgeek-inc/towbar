DROP INDEX "uq_towbar_sources_repository_branch";--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_sources_repository" ON "towbar_sources" USING btree ("workspace_id","repository_owner","repository_name");--> statement-breakpoint
ALTER TABLE "towbar_sources" DROP COLUMN "branch";