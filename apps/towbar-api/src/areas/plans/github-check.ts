import { eq, sql } from "drizzle-orm";

import {
  deploymentPlanGithubChecks,
  deploymentPlans,
  githubInstallations,
  sources,
} from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { upsertGitHubCheckRun } from "../github/client.js";

import type { DeploymentPlan } from "@workspace/towbar-core";

export const deploymentPlanCheckName = "Towbar deployment plan";
const maximumReportedRows = 50;

export function renderDeploymentPlanGitHubCheck(input: {
  plan: DeploymentPlan;
}) {
  const changed = input.plan.items.filter((item) => item.action !== "no_op");
  const summary =
    input.plan.status === "blocked"
      ? `${input.plan.checks.filter((check) => check.status === "failed").length} blocking validation issue(s) found.`
      : changed.length === 0
        ? "No deployment changes are required."
        : `${changed.length} deployment change(s) are ready for review.`;
  const itemRows = input.plan.items
    .slice(0, maximumReportedRows)
    .map(
      (item) =>
        `| ${label(item.action)} | ${label(item.entityKind)} | ${escapeCell(item.name)} | ${escapeCell(item.reasons.join("; "))} |`,
    );
  const checkRows = input.plan.checks
    .slice(0, maximumReportedRows)
    .map(
      (check) =>
        `| ${check.status === "passed" ? "Pass" : check.status === "warning" ? "Warning" : "Block"} | ${escapeCell(check.message)} |`,
    );
  return {
    conclusion:
      input.plan.status === "blocked"
        ? ("failure" as const)
        : input.plan.items.length === 0
          ? ("neutral" as const)
          : ("success" as const),
    output: {
      summary,
      text: [
        "## Planned changes",
        ...(itemRows.length > 0
          ? [
              "| Action | Kind | Name | Reason |",
              "| --- | --- | --- | --- |",
              ...itemRows,
              ...(input.plan.items.length > maximumReportedRows
                ? [
                    `| … | … | ${input.plan.items.length - maximumReportedRows} more | Open the Towbar plan for the complete comparison. |`,
                  ]
                : []),
            ]
          : ["No deployment-relevant changes matched this pull request."]),
        "",
        "## Validation",
        ...(checkRows.length > 0
          ? [
              "| Result | Check |",
              "| --- | --- |",
              ...checkRows,
              ...(input.plan.checks.length > maximumReportedRows
                ? [
                    `| … | ${input.plan.checks.length - maximumReportedRows} more validation results are available in Towbar. |`,
                  ]
                : []),
            ]
          : ["No additional validation checks were required."]),
      ].join("\n"),
      title:
        input.plan.status === "blocked"
          ? "Deployment plan blocked"
          : "Deployment plan ready",
    },
  };
}

export async function publishDeploymentPlanGitHubCheck(planId: string) {
  const database = getTowbarDatabase();
  try {
    const result = await database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          installationId: githubInstallations.installationId,
          plan: deploymentPlans.plan,
          planId: deploymentPlans.id,
          repositoryName: sources.repositoryName,
          repositoryOwner: sources.repositoryOwner,
          sourceId: sources.id,
          targetCommitSha: deploymentPlans.targetCommitSha,
        })
        .from(deploymentPlans)
        .innerJoin(sources, eq(sources.id, deploymentPlans.sourceId))
        .innerJoin(
          githubInstallations,
          eq(githubInstallations.id, sources.githubInstallationId),
        )
        .where(eq(deploymentPlans.id, planId))
        .limit(1);
      if (!row) throw notFound("Deployment plan");
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`deployment-plan-check:${row.sourceId}:${row.targetCommitSha}`}, 0))`,
      );
      const rendered = renderDeploymentPlanGitHubCheck({ plan: row.plan });
      const checkRunId = await upsertGitHubCheckRun({
        ...rendered,
        detailsUrl: `${getEnv().TOWBAR_APP_BASE_URL}/sources/${row.sourceId}/plans/${row.planId}`,
        externalId: row.planId,
        headSha: row.targetCommitSha,
        installationId: row.installationId,
        name: deploymentPlanCheckName,
        repositoryName: row.repositoryName,
        repositoryOwner: row.repositoryOwner,
      });
      const now = new Date();
      await transaction
        .insert(deploymentPlanGithubChecks)
        .values({
          checkRunId,
          lastAttemptedAt: now,
          planId,
          publishedAt: now,
          status: "published",
          updatedAt: now,
        })
        .onConflictDoUpdate({
          set: {
            checkRunId,
            errorMessage: null,
            lastAttemptedAt: now,
            publishedAt: now,
            status: "published",
            updatedAt: now,
          },
          target: deploymentPlanGithubChecks.planId,
        });
      return { checkRunId };
    });
    return result;
  } catch (error) {
    const now = new Date();
    await database
      .insert(deploymentPlanGithubChecks)
      .values({
        errorMessage:
          error instanceof Error
            ? error.message
            : "GitHub Check delivery failed",
        lastAttemptedAt: now,
        planId,
        status: "failed",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        set: {
          errorMessage:
            error instanceof Error
              ? error.message
              : "GitHub Check delivery failed",
          lastAttemptedAt: now,
          status: "failed",
          updatedAt: now,
        },
        target: deploymentPlanGithubChecks.planId,
      });
    throw error;
  }
}

function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./u, (character) => character.toUpperCase());
}

function escapeCell(value: string) {
  const normalized = value.replaceAll("|", "\\|").replaceAll("\n", " ");
  return normalized.length > 500 ? `${normalized.slice(0, 497)}…` : normalized;
}
