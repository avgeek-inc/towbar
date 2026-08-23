ALTER TYPE "public"."towbar_deployment_state" ADD VALUE 'running_pre_deploy' BEFORE 'starting_candidate';--> statement-breakpoint
ALTER TYPE "public"."towbar_deployment_state" ADD VALUE 'running_post_deploy' BEFORE 'cleaning_up';--> statement-breakpoint
ALTER TYPE "public"."towbar_deployment_state" ADD VALUE 'succeeded_with_warnings' BEFORE 'failed';