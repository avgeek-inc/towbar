import { and, eq } from "drizzle-orm";

import {
  deployments,
  previewEnvironments,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { publishPreviewDeploymentStatus } from "../deployments/preview-status.js";
import { publishPreviewPullRequestComment } from "./pr-comment.js";
import {
  listFailedPreviewReports,
  markPreviewReportDeliveryFailed,
  markPreviewReportDeliverySucceeded,
} from "./reporting-state.js";

import type { DeploymentState } from "@workspace/towbar-core/temporal";

export async function retryFailedPreviewReporting(workspaceId: string) {
  const reports = await listFailedPreviewReports(workspaceId);
  const results = [];
  for (const report of reports) {
    const errors: string[] = [];
    if (report.deploymentDeliveryStatus === "failed") {
      const latestDeployments = await getTowbarDatabase()
        .select({
          deploymentId: deployments.id,
          environmentStatus: previewEnvironments.status,
          state: deployments.state,
        })
        .from(previewEnvironments)
        .innerJoin(
          deployments,
          eq(deployments.id, previewEnvironments.latestDeploymentId),
        )
        .where(
          and(
            eq(previewEnvironments.sourceId, report.sourceId),
            eq(previewEnvironments.pullRequestNumber, report.pullRequestNumber),
          ),
        );
      for (const deployment of latestDeployments) {
        try {
          await publishPreviewDeploymentStatus(
            deployment.deploymentId,
            deployment.environmentStatus === "deleted"
              ? "inactive"
              : (deployment.state as DeploymentState),
          );
        } catch (error) {
          errors.push(
            error instanceof Error ? error.message : "GitHub request failed",
          );
        }
      }
      if (errors.length === 0) {
        await markPreviewReportDeliverySucceeded(report, "deployment");
      } else {
        await markPreviewReportDeliveryFailed(
          report,
          "deployment",
          new Error(errors.join("; ")),
        );
      }
    }
    if (report.commentDeliveryStatus === "failed") {
      try {
        await publishPreviewPullRequestComment(report);
      } catch (error) {
        errors.push(
          error instanceof Error ? error.message : "GitHub request failed",
        );
      }
    }
    results.push({
      pullRequestNumber: report.pullRequestNumber,
      sourceId: report.sourceId,
      succeeded: errors.length === 0,
    });
  }
  return {
    attempted: results.length,
    failed: results.filter((result) => !result.succeeded).length,
    succeeded: results.filter((result) => result.succeeded).length,
  };
}
