import { and, eq, isNull } from "drizzle-orm";

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
  await getTowbarDatabase()
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
      ),
    );
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
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
    })
    .from(deployments)
    .innerJoin(sources, eq(sources.id, deployments.sourceId))
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
  let githubDeploymentId = deployment.githubDeploymentId;
  if (state === "inactive" && !githubDeploymentId) return;
  if (!githubDeploymentId) {
    githubDeploymentId = await createGitHubPreviewDeployment({
      commitSha: deployment.commitSha,
      environment:
        `Preview · ${deployment.app.name} · ${deployment.gitRef.slice("refs/heads/".length)}`.slice(
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
  if (!githubState) return;
  await updateGitHubPreviewDeployment({
    deploymentId: githubDeploymentId,
    environmentUrl: `https://${deployment.hostname}`,
    installationId: deployment.installationId,
    repositoryName: deployment.repositoryName,
    repositoryOwner: deployment.repositoryOwner,
    state: githubState,
  });
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
