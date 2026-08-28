import { and, count, desc, eq, or } from "drizzle-orm";

import { previewPullRequestReports } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";

export type PreviewReportDelivery = "comment" | "deployment";
export type PreviewSkippedApp = {
  appId: string;
  appName: string;
  reason: string;
};

export async function recordPreviewPullRequestPlan(input: {
  branch: string;
  hasDeployments: boolean;
  latestCommitSha: string;
  pullRequestNumber: number;
  skippedApps: PreviewSkippedApp[];
  sourceId: string;
  workspaceId: string;
}) {
  const now = new Date();
  const [report] = await getTowbarDatabase()
    .insert(previewPullRequestReports)
    .values({
      branch: input.branch,
      closedAt: null,
      commentDeliveryError: null,
      commentDeliveryStatus: "pending",
      deploymentDeliveryError: null,
      deploymentDeliveryStatus: input.hasDeployments ? "pending" : "published",
      deploymentPublishedAt: input.hasDeployments ? null : now,
      latestCommitSha: input.latestCommitSha,
      pullRequestNumber: input.pullRequestNumber,
      skippedApps: input.skippedApps,
      sourceId: input.sourceId,
      updatedAt: now,
      workspaceId: input.workspaceId,
    })
    .onConflictDoUpdate({
      target: [
        previewPullRequestReports.sourceId,
        previewPullRequestReports.pullRequestNumber,
      ],
      set: {
        branch: input.branch,
        closedAt: null,
        commentDeliveryError: null,
        commentDeliveryStatus: "pending",
        latestCommitSha: input.latestCommitSha,
        skippedApps: input.skippedApps,
        updatedAt: now,
      },
    })
    .returning({ id: previewPullRequestReports.id });
  return report;
}

export async function closePreviewPullRequestReport(input: {
  pullRequestNumber: number;
  sourceId: string;
}) {
  const now = new Date();
  await getTowbarDatabase()
    .update(previewPullRequestReports)
    .set({ closedAt: now, updatedAt: now })
    .where(reportIdentity(input));
}

export async function markPreviewReportDeliveryAttempt(
  input: { pullRequestNumber: number; sourceId: string },
  delivery: PreviewReportDelivery,
) {
  const now = new Date();
  await getTowbarDatabase()
    .update(previewPullRequestReports)
    .set(
      delivery === "comment"
        ? {
            commentDeliveryError: null,
            commentDeliveryStatus: "pending",
            commentLastAttemptedAt: now,
            updatedAt: now,
          }
        : {
            deploymentDeliveryError: null,
            deploymentDeliveryStatus: "pending",
            deploymentLastAttemptedAt: now,
            updatedAt: now,
          },
    )
    .where(reportIdentity(input));
}

export async function markPreviewReportDeliverySucceeded(
  input: { pullRequestNumber: number; sourceId: string },
  delivery: PreviewReportDelivery,
) {
  const now = new Date();
  await getTowbarDatabase()
    .update(previewPullRequestReports)
    .set(
      delivery === "comment"
        ? {
            commentDeliveryError: null,
            commentDeliveryStatus: "published",
            commentPublishedAt: now,
            updatedAt: now,
          }
        : {
            deploymentDeliveryError: null,
            deploymentDeliveryStatus: "published",
            deploymentPublishedAt: now,
            updatedAt: now,
          },
    )
    .where(reportIdentity(input));
}

export async function markPreviewReportDeliveryFailed(
  input: { pullRequestNumber: number; sourceId: string },
  delivery: PreviewReportDelivery,
  error: unknown,
) {
  const now = new Date();
  const message = previewReportingErrorMessage(error);
  await getTowbarDatabase()
    .update(previewPullRequestReports)
    .set(
      delivery === "comment"
        ? {
            commentDeliveryError: message,
            commentDeliveryStatus: "failed",
            updatedAt: now,
          }
        : {
            deploymentDeliveryError: message,
            deploymentDeliveryStatus: "failed",
            updatedAt: now,
          },
    )
    .where(reportIdentity(input));
  return message;
}

export async function getPreviewReportingHealth(workspaceId: string) {
  const database = getTowbarDatabase();
  const failureFilter = and(
    eq(previewPullRequestReports.workspaceId, workspaceId),
    or(
      eq(previewPullRequestReports.commentDeliveryStatus, "failed"),
      eq(previewPullRequestReports.deploymentDeliveryStatus, "failed"),
    ),
  );
  const [[summary], failures] = await Promise.all([
    database
      .select({ failedCount: count() })
      .from(previewPullRequestReports)
      .where(failureFilter),
    database
      .select({
        commentDeliveryError: previewPullRequestReports.commentDeliveryError,
        deploymentDeliveryError:
          previewPullRequestReports.deploymentDeliveryError,
        pullRequestNumber: previewPullRequestReports.pullRequestNumber,
        sourceId: previewPullRequestReports.sourceId,
        updatedAt: previewPullRequestReports.updatedAt,
      })
      .from(previewPullRequestReports)
      .where(failureFilter)
      .orderBy(desc(previewPullRequestReports.updatedAt))
      .limit(1),
  ]);
  const latest = failures[0];
  return {
    failedCount: summary?.failedCount ?? 0,
    lastError:
      latest?.commentDeliveryError ?? latest?.deploymentDeliveryError ?? null,
    lastFailedAt: latest?.updatedAt ?? null,
  };
}

export async function listFailedPreviewReports(
  workspaceId: string,
  limit = 50,
) {
  return await getTowbarDatabase()
    .select({
      commentDeliveryStatus: previewPullRequestReports.commentDeliveryStatus,
      deploymentDeliveryStatus:
        previewPullRequestReports.deploymentDeliveryStatus,
      pullRequestNumber: previewPullRequestReports.pullRequestNumber,
      sourceId: previewPullRequestReports.sourceId,
    })
    .from(previewPullRequestReports)
    .where(
      and(
        eq(previewPullRequestReports.workspaceId, workspaceId),
        or(
          eq(previewPullRequestReports.commentDeliveryStatus, "failed"),
          eq(previewPullRequestReports.deploymentDeliveryStatus, "failed"),
        ),
      ),
    )
    .orderBy(desc(previewPullRequestReports.updatedAt))
    .limit(limit);
}

export function previewReportingErrorMessage(error: unknown) {
  const message =
    error instanceof Error ? error.message : "GitHub request failed";
  return message
    .replace(/Bearer\s+[^\s]+/giu, "Bearer [redacted]")
    .replace(/(token|secret|password)=([^&\s]+)/giu, "$1=[redacted]")
    .slice(0, 1_000);
}

function reportIdentity(input: {
  pullRequestNumber: number;
  sourceId: string;
}) {
  return and(
    eq(previewPullRequestReports.sourceId, input.sourceId),
    eq(previewPullRequestReports.pullRequestNumber, input.pullRequestNumber),
  );
}
