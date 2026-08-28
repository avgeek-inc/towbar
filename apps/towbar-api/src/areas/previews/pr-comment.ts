import { and, asc, eq } from "drizzle-orm";

import {
  apps,
  deployments,
  githubInstallations,
  previewEnvironments,
  previewPullRequestReports,
  sources,
} from "@workspace/towbar-database/schema";

import { getEnv } from "../../env.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { upsertGitHubPullRequestComment } from "../github/client.js";
import {
  type PreviewSkippedApp,
  markPreviewReportDeliveryAttempt,
  markPreviewReportDeliveryFailed,
  markPreviewReportDeliverySucceeded,
} from "./reporting-state.js";

import type { DeploymentState } from "@workspace/towbar-core/temporal";

type PreviewEnvironmentStatus =
  (typeof previewEnvironments.$inferSelect)["status"];

const deploymentCommentStatuses = {
  building: "🟡 Building",
  cancelled: "⚪ Inactive",
  checking_health: "🟡 Checking health",
  checking_public_endpoint: "🟡 Checking health",
  checking_server: "🟡 Preparing",
  cleaning_up: "🟡 Preparing",
  configuring_routing: "🟡 Deploying",
  failed: "🔴 Failed",
  fetching_source: "🟡 Preparing",
  preparing: "🟡 Preparing",
  provisioning_tls: "🟡 Deploying",
  queued: "🟡 Queued",
  resolving_secrets: "🟡 Preparing",
  running_post_deploy: "🟡 Preparing",
  running_pre_deploy: "🟡 Preparing",
  skipped: "⚪ Inactive",
  starting_candidate: "🟡 Preparing",
  succeeded: "🟢 Ready",
  succeeded_with_warnings: "🟢 Ready",
  switching_traffic: "🟡 Deploying",
  transferring: "🟡 Preparing",
  validating_credentials: "🟡 Preparing",
  waiting_for_server: "🟡 Waiting for server",
} satisfies Record<DeploymentState, string>;

const environmentCommentStatuses: Partial<
  Record<PreviewEnvironmentStatus, string>
> = {
  cleanup_failed: "🔴 Cleanup failed",
  deleted: "⚪ Cleaned up",
  deleting: "⚪ Cleaning up",
  failed: "🔴 Failed",
  healthy: "🟢 Ready",
};

export type PreviewPullRequestCommentEntry = {
  appName: string;
  deploymentId: string | null;
  deploymentState: DeploymentState | null;
  environmentStatus: PreviewEnvironmentStatus | null;
  hostname: string | null;
  skippedReason?: string;
};

export async function publishPreviewPullRequestComment(input: {
  pullRequestNumber: number;
  sourceId: string;
}) {
  const database = getTowbarDatabase();
  const [[source], environments, [report]] = await Promise.all([
    database
      .select({
        installationId: githubInstallations.installationId,
        repositoryName: sources.repositoryName,
        repositoryOwner: sources.repositoryOwner,
      })
      .from(sources)
      .innerJoin(
        githubInstallations,
        eq(githubInstallations.id, sources.githubInstallationId),
      )
      .where(eq(sources.id, input.sourceId))
      .limit(1),
    database
      .select({
        appId: previewEnvironments.appId,
        appName: apps.name,
        deploymentId: previewEnvironments.latestDeploymentId,
        deploymentState: deployments.state,
        environmentStatus: previewEnvironments.status,
        hostname: previewEnvironments.hostname,
      })
      .from(previewEnvironments)
      .innerJoin(apps, eq(apps.id, previewEnvironments.appId))
      .leftJoin(
        deployments,
        eq(deployments.id, previewEnvironments.latestDeploymentId),
      )
      .where(
        and(
          eq(previewEnvironments.sourceId, input.sourceId),
          eq(previewEnvironments.pullRequestNumber, input.pullRequestNumber),
        ),
      )
      .orderBy(asc(apps.name)),
    database
      .select({ skippedApps: previewPullRequestReports.skippedApps })
      .from(previewPullRequestReports)
      .where(
        and(
          eq(previewPullRequestReports.sourceId, input.sourceId),
          eq(
            previewPullRequestReports.pullRequestNumber,
            input.pullRequestNumber,
          ),
        ),
      )
      .limit(1),
  ]);
  const entries = combinePreviewPullRequestCommentEntries(
    environments,
    report?.skippedApps ?? [],
  );
  if (!source || entries.length === 0) return null;
  const marker = previewPullRequestCommentMarker(input);
  await markPreviewReportDeliveryAttempt(input, "comment");
  try {
    const comment = await upsertGitHubPullRequestComment({
      body: renderPreviewPullRequestComment({
        appBaseUrl: getEnv().TOWBAR_APP_BASE_URL,
        entries,
        marker,
        sourceId: input.sourceId,
      }),
      installationId: source.installationId,
      marker,
      pullRequestNumber: input.pullRequestNumber,
      repositoryName: source.repositoryName,
      repositoryOwner: source.repositoryOwner,
    });
    await markPreviewReportDeliverySucceeded(input, "comment");
    return comment;
  } catch (error) {
    await markPreviewReportDeliveryFailed(input, "comment", error);
    throw error;
  }
}

export function combinePreviewPullRequestCommentEntries(
  environments: Array<PreviewPullRequestCommentEntry & { appId: string }>,
  skippedApps: PreviewSkippedApp[],
) {
  const skippedAppIds = new Set(skippedApps.map((app) => app.appId));
  const activeEnvironmentAppIds = new Set(
    environments
      .filter((environment) => environment.environmentStatus !== "deleted")
      .map((environment) => environment.appId),
  );
  return [
    ...environments
      .filter(
        (environment) =>
          environment.environmentStatus !== "deleted" ||
          !skippedAppIds.has(environment.appId),
      )
      .map(({ appId: _appId, ...environment }) => environment),
    ...skippedApps
      .filter((app) => !activeEnvironmentAppIds.has(app.appId))
      .map((app) => ({
        appName: app.appName,
        deploymentId: null,
        deploymentState: null,
        environmentStatus: null,
        hostname: null,
        skippedReason: app.reason,
      })),
  ].sort((left, right) => left.appName.localeCompare(right.appName));
}

export async function publishPreviewPullRequestCommentForDeployment(
  deploymentId: string,
) {
  const [preview] = await getTowbarDatabase()
    .select({
      pullRequestNumber: previewEnvironments.pullRequestNumber,
      sourceId: previewEnvironments.sourceId,
    })
    .from(deployments)
    .innerJoin(
      previewEnvironments,
      eq(previewEnvironments.id, deployments.previewEnvironmentId),
    )
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!preview) return null;
  return await publishPreviewPullRequestComment(preview);
}

export async function publishPreviewPullRequestCommentForEnvironment(
  previewEnvironmentId: string,
) {
  const [preview] = await getTowbarDatabase()
    .select({
      pullRequestNumber: previewEnvironments.pullRequestNumber,
      sourceId: previewEnvironments.sourceId,
    })
    .from(previewEnvironments)
    .where(eq(previewEnvironments.id, previewEnvironmentId))
    .limit(1);
  if (!preview) return null;
  return await publishPreviewPullRequestComment(preview);
}

export function previewPullRequestCommentMarker(input: {
  pullRequestNumber: number;
  sourceId: string;
}) {
  return `<!-- towbar:preview-status:${input.sourceId}:${input.pullRequestNumber} -->`;
}

export function renderPreviewPullRequestComment(input: {
  appBaseUrl: string;
  entries: PreviewPullRequestCommentEntry[];
  marker: string;
  sourceId: string;
}) {
  const visibleEntries = input.entries.slice(0, 50);
  const rows = visibleEntries.map((entry) => {
    const deploymentUrl = entry.deploymentId
      ? new URL(
          `/sources/${encodeURIComponent(input.sourceId)}/deployments/${encodeURIComponent(entry.deploymentId)}`,
          input.appBaseUrl,
        ).toString()
      : null;
    const status = previewCommentStatus(entry);
    const preview =
      entry.environmentStatus === "healthy" && entry.hostname
        ? `[Open preview](https://${entry.hostname})`
        : "—";
    return `| ${escapeMarkdownTableCell(entry.appName)} | ${status} | ${preview} | ${deploymentUrl ? `[View details](${deploymentUrl})` : "—"} |`;
  });
  const remaining = input.entries.length - visibleEntries.length;
  return [
    input.marker,
    "## Towbar previews",
    "",
    "| App | Build status | Preview | Deployment |",
    "| --- | --- | --- | --- |",
    ...rows,
    ...(remaining > 0
      ? [
          "",
          `_And ${remaining} more preview${remaining === 1 ? "" : "s"} in Towbar._`,
        ]
      : []),
    "",
    "<sub>This comment is updated automatically by Towbar.</sub>",
  ].join("\n");
}

function previewCommentStatus(entry: PreviewPullRequestCommentEntry) {
  if (entry.skippedReason) {
    return `⚪ Skipped — ${escapeMarkdownTableCell(entry.skippedReason)}`;
  }
  return (
    (entry.environmentStatus
      ? environmentCommentStatuses[entry.environmentStatus]
      : undefined) ??
    (entry.deploymentState
      ? deploymentCommentStatuses[entry.deploymentState]
      : "🟡 Preparing")
  );
}

function escapeMarkdownTableCell(value: string) {
  return value
    .replaceAll("\r", " ")
    .replaceAll("\n", " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|");
}
