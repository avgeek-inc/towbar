ALTER TYPE "public"."towbar_deployment_plan_status" ADD VALUE 'skipped';--> statement-breakpoint
WITH "ranked_pull_request_plans" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "source_id", "pull_request_number", "target_commit_sha"
			ORDER BY "created_at" DESC, "id" DESC
		) AS "duplicate_rank"
	FROM "towbar_deployment_plans"
	WHERE "trigger" = 'pull_request'
)
DELETE FROM "towbar_deployment_plans"
USING "ranked_pull_request_plans"
WHERE "towbar_deployment_plans"."id" = "ranked_pull_request_plans"."id"
	AND "ranked_pull_request_plans"."duplicate_rank" > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_towbar_deployment_plans_pull_request_head" ON "towbar_deployment_plans" USING btree ("source_id","pull_request_number","target_commit_sha") WHERE "towbar_deployment_plans"."trigger" = 'pull_request';
