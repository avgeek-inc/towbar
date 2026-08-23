CREATE TABLE "towbar_auth_rate_limit_buckets" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_towbar_auth_rate_limit_expires" ON "towbar_auth_rate_limit_buckets" USING btree ("expires_at");