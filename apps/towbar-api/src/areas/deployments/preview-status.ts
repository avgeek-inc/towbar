import { and, eq, isNull, notInArray } from "drizzle-orm";

import { terminalDeploymentStates } from "@workspace/towbar-core/temporal";
import {
  deployments,
  githubInstallations,
  previewEnvironments,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import {
  createGitHubPreviewDeployment,
  updateGitHubPreviewDeployment,
} from "../github/client.js";
import { publishPreviewPullRequestCommentForDeployment } from "../previews/pr-comment.js";
import { emitPreviewNotification } from "../notifications/events.js";
import {
  markPreviewReportDeliveryAttempt,
  markPreviewReportDeliveryFailed,
  markPreviewReportDeliverySucceeded,
} from "../previews/reporting-state.js";

import type { DeploymentState } from "@workspace/towbar-core/temporal";

export async function recordPreviewTerminalState(
  deploymentId: string,
  state: DeploymentState,
) {
  if (!terminalDeploymentStates.has(state)) return;
  const [deployment] = await getTowbarDatabase()
    .select({
      errorMessage: deployments.errorMessage,
      previewEnvironmentId: deployments.previewEnvironmentId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!deployment?.previewEnvironmentId) return;
  const succeeded = ["succeeded", "succeeded_with_warnings"].includes(state);
  const [updated] = await getTowbarDatabase()
    .update(previewEnvironments)
    .set({
      errorMessage: succeeded ? null : deployment.errorMessage,
      status: succeeded ? "healthy" : "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(previewEnvironments.id, deployment.previewEnvironmentId),
        eq(previewEnvironments.latestDeploymentId, deploymentId),
        notInArray(previewEnvironments.status, ["deleting", "deleted"]),
      ),
    )
    .returning({ id: previewEnvironments.id });
  if (updated && (succeeded || state === "failed")) {
    await emitPreviewNotification(
      updated.id,
      succeeded ? "preview.ready" : "preview.failed",
    ).catch(() => undefined);
  }
}

export async function propagatePreviewDeploymentState(
  deploymentId: string,
  state: DeploymentState,
  options: { publish?: boolean } = {},
) {
  await recordPreviewTerminalState(deploymentId, state);
  if (options.publish !== false) {
    await Promise.all([
      publishPreviewDeploymentStatus(deploymentId, state).catch(
        () => undefined,
      ),
      publishPreviewPullRequestCommentForDeployment(deploymentId).catch(
        () => undefined,
      ),
    ]);
  }
}

export async function publishPreviewDeploymentStatus(
  deploymentId: string,
  state: DeploymentState | "inactive",
) {
  const [deployment] = await getTowbarDatabase()
    .select({
      app: deployments.appSnapshot,
      commitSha: deployments.commitSha,
      gitRef: deployments.gitRef,
      githubDeploymentId: deployments.githubDeploymentId,
      hostname: deployments.hostname,
      installationId: githubInstallations.installationId,
      pullRequestNumber: previewEnvironments.pullRequestNumber,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      sourceId: deployments.sourceId,
    })
    .from(deployments)
    .innerJoin(sources, eq(sources.id, deployments.sourceId))
    .innerJoin(
      previewEnvironments,
      eq(previewEnvironments.id, deployments.previewEnvironmentId),
    )
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(deployments.environment, "preview"),
      ),
    )
    .limit(1);
  if (!deployment?.hostname || !deployment.gitRef) return;
  const report = {
    pullRequestNumber: deployment.pullRequestNumber,
    sourceId: deployment.sourceId,
  };
  await markPreviewReportDeliveryAttempt(report, "deployment");
  try {
    let githubDeploymentId = deployment.githubDeploymentId;
    if (state !== "inactive" || githubDeploymentId) {
      if (!githubDeploymentId) {
        githubDeploymentId = await createGitHubPreviewDeployment({
          commitSha: deployment.commitSha,
          environment:
            `Preview · ${deployment.app.name} · PR #${deployment.pullRequestNumber}`.slice(
              0,
              255,
            ),
          environmentUrl: `https://${deployment.hostname}`,
          installationId: deployment.installationId,
          repositoryName: deployment.repositoryName,
          repositoryOwner: deployment.repositoryOwner,
        });
        await getTowbarDatabase()
          .update(deployments)
          .set({ githubDeploymentId, updatedAt: new Date() })
          .where(
            and(
              eq(deployments.id, deploymentId),
              isNull(deployments.githubDeploymentId),
            ),
          );
      }
      const githubState =
        state === "inactive" ? "inactive" : previewGitHubDeploymentState(state);
      if (githubState) {
        await updateGitHubPreviewDeployment({
          deploymentId: githubDeploymentId,
          environmentUrl: `https://${deployment.hostname}`,
          installationId: deployment.installationId,
          repositoryName: deployment.repositoryName,
          repositoryOwner: deployment.repositoryOwner,
          state: githubState,
        });
      }
    }
    await markPreviewReportDeliverySucceeded(report, "deployment");
  } catch (error) {
    await markPreviewReportDeliveryFailed(report, "deployment", error);
    throw error;
  }
}

function previewGitHubDeploymentState(state: DeploymentState) {
  switch (state) {
    case "queued":
      return "queued" as const;
    case "waiting_for_server":
    case "preparing":
    case "validating_credentials":
    case "checking_server":
    case "fetching_source":
    case "resolving_secrets":
    case "transferring":
    case "building":
    case "running_pre_deploy":
    case "starting_candidate":
    case "checking_health":
    case "configuring_routing":
    case "provisioning_tls":
    case "checking_public_endpoint":
    case "switching_traffic":
    case "running_post_deploy":
    case "cleaning_up":
      return "in_progress" as const;
    case "succeeded":
    case "succeeded_with_warnings":
      return "success" as const;
    case "failed":
      return "failure" as const;
    case "cancelled":
    case "skipped":
      return "inactive" as const;
  }
}
