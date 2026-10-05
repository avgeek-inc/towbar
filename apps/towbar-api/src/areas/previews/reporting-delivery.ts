import { sql } from "drizzle-orm";
import { previewPullRequestReports } from "@workspace/towbar-database/schema";
import {
  getPreviewReportingLockDatabase,
  getTowbarDatabase,
} from "../../infrastructure/database.js";
import { previewReportDeliveryIsDue } from "./reporting-policy.js";
import {
  type PreviewReportDelivery,
  markPreviewReportDeliveryAttempt,
  markPreviewReportDeliveryFailed,
  markPreviewReportDeliverySucceeded,
  reportIdentity,
} from "./reporting-state.js";

export type PreviewReportIdentity = {
  sourceId: string;
  pullRequestNumber: number;
};

export async function deliverPreviewReport<T>(
  input: PreviewReportIdentity,
  delivery: PreviewReportDelivery,
  publish: () => Promise<T>,
  options: { onlyIfDue?: boolean; force?: boolean } = {},
): Promise<T | null> {
  const database = getTowbarDatabase();
  const lockKey =
    delivery === "comment"
      ? `<!-- towbar:preview-status:${input.sourceId}:${input.pullRequestNumber} -->`
      : `preview-report:${input.sourceId}:${input.pullRequestNumber}:${delivery}`;
  return await getPreviewReportingLockDatabase().transaction(
    async (transaction) => {
      const [lock] = await transaction.execute<{ locked: boolean }>(
        sql`select pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) as locked`,
      );
      if (!lock?.locked) {
        if (!options.onlyIfDue) {
          // A newer state arrived during publication. Invalidate the older
          // attempt's completion so maintenance will publish the current state.
          const now = new Date();
          await transaction
            .update(previewPullRequestReports)
            .set(
              delivery === "comment"
                ? {
                    commentDeliveryAttempts: sql`${previewPullRequestReports.commentDeliveryAttempts} + 1`,
                    commentDeliveryStatus: "pending",
                    commentLastAttemptedAt: now,
                    commentNextAttemptAt: new Date(now.getTime() + 5 * 60_000),
                    updatedAt: now,
                  }
                : {
                    deploymentDeliveryAttempts: sql`${previewPullRequestReports.deploymentDeliveryAttempts} + 1`,
                    deploymentDeliveryStatus: "pending",
                    deploymentLastAttemptedAt: now,
                    deploymentNextAttemptAt: new Date(
                      now.getTime() + 5 * 60_000,
                    ),
                    updatedAt: now,
                  },
            )
            .where(reportIdentity(input));
        }
        return null;
      }
      const [report] = await database
        .select()
        .from(previewPullRequestReports)
        .where(reportIdentity(input))
        .limit(1);
      if (!report) return null;
      const state =
        delivery === "comment"
          ? {
              status: report.commentDeliveryStatus,
              nextAttemptAt: report.commentNextAttemptAt,
              updatedAt: report.updatedAt,
            }
          : {
              status: report.deploymentDeliveryStatus,
              nextAttemptAt: report.deploymentNextAttemptAt,
              updatedAt: report.updatedAt,
            };
      if (options.onlyIfDue && state.status === "published") return null;
      if (
        !options.force &&
        ((options.onlyIfDue && !previewReportDeliveryIsDue(state)) ||
          (state.status !== "published" &&
            state.nextAttemptAt !== null &&
            !previewReportDeliveryIsDue(state)))
      )
        return null;
      const attemptedAt = await markPreviewReportDeliveryAttempt(
        input,
        delivery,
      );
      try {
        const result = await publish();
        await markPreviewReportDeliverySucceeded(input, delivery, attemptedAt);
        return result;
      } catch (error) {
        await markPreviewReportDeliveryFailed(
          input,
          delivery,
          error,
          attemptedAt,
        );
        throw error;
      }
    },
  );
}
