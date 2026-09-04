import { and, eq } from "drizzle-orm";
import {
  createPreviewAppSnapshot,
  isNormalizedResource,
  previewHostname,
} from "@workspace/towbar-core";
import {
  apps,
  githubInstallations,
  previewEnvironments,
  servers,
  sources,
} from "@workspace/towbar-database/schema";
import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueueDeployment } from "../../infrastructure/temporal.js";
import {
  fetchGitHubPullRequest,
  fetchGitHubRepositoryTree,
} from "../github/client.js";
import { publishPreviewDeploymentStatus } from "../deployments/preview-status.js";
import { emitDeploymentNotification } from "../notifications/events.js";
import { calculateReleaseDeploymentDigest } from "../sources/deployment-digests.js";
import { previewPullRequestDisposition } from "./pull-request.js";
import { admitPreviewDeployment } from "./admission.js";

// Explicit editor action: revalidate the PR and use current manifest-owned
// infrastructure, while secret assignments remain owned by the persisted app ID.
export async function requestPreviewDeployment(input: {
  previewEnvironmentId: string;
  workspaceId: string;
  requestedBy: string;
}) {
  const database = getTowbarDatabase();
  const [row] = await database
    .select({
      preview: previewEnvironments,
      app: apps,
      server: servers,
      source: sources,
      installationId: githubInstallations.installationId,
    })
    .from(previewEnvironments)
    .innerJoin(apps, eq(apps.id, previewEnvironments.appId))
    .innerJoin(servers, eq(servers.id, apps.serverId))
    .innerJoin(sources, eq(sources.id, apps.sourceId))
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(
      and(
        eq(previewEnvironments.id, input.previewEnvironmentId),
        eq(previewEnvironments.workspaceId, input.workspaceId),
      ),
    )
    .limit(1);
  if (!row) throw notFound("Preview");
  const { app, server, source, preview } = row;
  if (
    app.archivedAt ||
    source.status !== "active" ||
    isNormalizedResource(app.config) ||
    !app.config.preview?.enabled
  )
    throw conflict("Preview is no longer enabled for this app");
  if (!server.preparedAt || server.preparedConfigDigest !== server.configDigest)
    throw conflict("Prepare the server before deploying this preview");
  if (!source.latestManifestDigest)
    throw conflict("Sync the Source before deploying");
  const pullRequest = await fetchGitHubPullRequest({
    installationId: row.installationId,
    pullRequestNumber: preview.pullRequestNumber,
    repositoryName: source.repositoryName,
    repositoryOwner: source.repositoryOwner,
  });
  if (
    previewPullRequestDisposition({
      pullRequest,
      repositoryName: source.repositoryName,
      repositoryOwner: source.repositoryOwner,
      sourceBranch: source.branch,
    }).action !== "deploy"
  )
    throw conflict("This pull request is no longer eligible for previews");
  const hostname = previewHostname({
    appId: app.manifestId,
    domain: app.config.preview.domain,
    pullRequestNumber: preview.pullRequestNumber,
    sourceId: source.id,
  });
  if (server.id !== preview.serverId || hostname !== preview.hostname)
    throw conflict(
      "Preview infrastructure changed. Remove this preview before recreating it.",
    );
  const config = createPreviewAppSnapshot(app.config, {
    branch: pullRequest.headBranch,
    hostname,
  });
  const repositoryTree = app.config.deploymentInputs.length
    ? await fetchGitHubRepositoryTree({
        commitSha: pullRequest.headSha,
        installationId: row.installationId,
        repositoryName: source.repositoryName,
        repositoryOwner: source.repositoryOwner,
      })
    : undefined;
  const digests = calculateReleaseDeploymentDigest({
    commitSha: pullRequest.headSha,
    deployable: config,
    deploymentInputs: app.config.deploymentInputs,
    repositoryTree,
    server: server.config,
  });
  const admission = await admitPreviewDeployment({
    appId: app.id,
    branch: pullRequest.headBranch,
    commitSha: pullRequest.headSha,
    config,
    ...digests,
    hostname,
    manifestDigest: source.latestManifestDigest,
    pullRequestNumber: preview.pullRequestNumber,
    server: server.config,
    serverId: server.id,
    sourceId: source.id,
    ttlHours: app.config.preview.ttlHours,
    workspaceId: input.workspaceId,
    force: true,
    requestedBy: input.requestedBy,
  });
  if (!admission.created || !admission.deploymentId)
    throw conflict("Preview cannot be deployed while cleanup is active");
  await emitDeploymentNotification(
    admission.deploymentId,
    "deployment.queued",
  ).catch(() => undefined);
  await publishPreviewDeploymentStatus(admission.deploymentId, "queued").catch(
    () => undefined,
  );
  await enqueueDeployment({
    appId: app.id,
    buildConcurrency: server.config.buildConcurrency ?? 1,
    deploymentId: admission.deploymentId,
    previewBuildConcurrency: server.config.previewBuildConcurrency ?? 1,
    priority: "preview",
    serverIp: server.config.ip,
  });
  return { accepted: true, deploymentId: admission.deploymentId };
}
