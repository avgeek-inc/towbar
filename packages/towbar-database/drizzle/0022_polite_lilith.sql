DROP INDEX "idx_towbar_server_checks_server";--> statement-breakpoint
CREATE INDEX "idx_towbar_server_checks_server" ON "towbar_server_checks" USING btree ("server_id","created_at","id");