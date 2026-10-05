import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import { previewPullRequestReports } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { publishPreviewDeploymentReport } from "../deployments/preview-status.js";
import { publishPreviewPullRequestComment } from "./pr-comment.js";
import { previewReportingRecoveryDelayMs } from "./reporting-policy.js";

export async function retryFailedPreviewReporting(workspaceId: string) {
  return await recoverPreviewReporting({ workspaceId, force: true, limit: 50 });
}

export async function recoverPreviewReporting(
  options: { workspaceId?: string; force?: boolean; limit?: number } = {},
) {
  const now = new Date();
  const report = previewPullRequestReports;
  const due = (
    status:
      | typeof report.commentDeliveryStatus
      | typeof report.deploymentDeliveryStatus,
    next:
      | typeof report.commentNextAttemptAt
      | typeof report.deploymentNextAttemptAt,
  ) =>
    and(
      or(eq(status, "failed"), eq(status, "pending")),
      options.force
        ? or(
            eq(status, "failed"),
            lte(
              report.updatedAt,
              new Date(now.getTime() - previewReportingRecoveryDelayMs),
            ),
          )
        : or(
            lte(next, now),
            and(
              isNull(next),
              or(
                eq(status, "failed"),
                lte(
                  report.updatedAt,
                  new Date(now.getTime() - previewReportingRecoveryDelayMs),
                ),
              ),
            ),
          ),
    );
  const reports = await getTowbarDatabase()
    .select({
      sourceId: report.sourceId,
      pullRequestNumber: report.pullRequestNumber,
      commentDeliveryStatus: report.commentDeliveryStatus,
      deploymentDeliveryStatus: report.deploymentDeliveryStatus,
    })
    .from(report)
    .where(
      and(
        options.workspaceId
          ? eq(report.workspaceId, options.workspaceId)
          : undefined,
        or(
          due(report.commentDeliveryStatus, report.commentNextAttemptAt),
          due(report.deploymentDeliveryStatus, report.deploymentNextAttemptAt),
        ),
      ),
    )
    .orderBy(asc(report.updatedAt))
    .limit(options.limit ?? 5);
  let failed = 0;
  let attempted = 0;
  const deadline = Date.now() + 60_000;
  for (const item of reports) {
    if (Date.now() >= deadline) break;
    const deliveryOptions = { onlyIfDue: true, force: options.force };
    const results = await Promise.allSettled([
      publishPreviewDeploymentReport(item, deliveryOptions),
      publishPreviewPullRequestComment(item, deliveryOptions),
    ]);
    if (
      results.every(
        (result) => result.status === "fulfilled" && result.value === null,
      )
    )
      continue;
    attempted += 1;
    if (results.some((result) => result.status === "rejected")) failed += 1;
  }
  return { attempted, failed, succeeded: attempted - failed };
}
