import { and, eq, isNull, ne } from "drizzle-orm";

import { isNormalizedResource } from "@workspace/towbar-core";
import {
  apps,
  githubInstallations,
  previewEnvironments,
  previewPullRequestReports,
  sourceEnvironments,
  sourceSyncs,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { enqueuePreviewPullRequestEvent } from "../../infrastructure/temporal.js";
import { listOpenGitHubPullRequestNumbers } from "../github/client.js";
import { previewPullRequestsToReconcile } from "./pull-request.js";

export async function scheduleSourcePreviewReconciliations(
  sourceId: string,
  dependencies = {
    listPullRequests: listOpenGitHubPullRequestNumbers,
    enqueue: enqueuePreviewPullRequestEvent,
  },
) {
  const database = getTowbarDatabase();
  const [[source], appRows] = await Promise.all([
    database
      .select({
        installationId: githubInstallations.installationId,
        repositoryName: sources.repositoryName,
        repositoryOwner: sources.repositoryOwner,
        status: sources.status,
      })
      .from(sources)
      .innerJoin(
        githubInstallations,
        eq(githubInstallations.id, sources.githubInstallationId),
      )
      .where(eq(sources.id, sourceId))
      .limit(1),
    database
      .select({ config: apps.config, branch: sourceEnvironments.branch })
      .from(apps)
      .innerJoin(
        sourceEnvironments,
        eq(sourceEnvironments.id, apps.sourceEnvironmentId),
      )
      .innerJoin(
        sourceSyncs,
        eq(sourceSyncs.id, sourceEnvironments.latestSuccessfulSyncId),
      )
      .where(
        and(
          eq(apps.sourceId, sourceId),
          eq(apps.kind, "app"),
          isNull(apps.archivedAt),
          isNull(sourceEnvironments.disconnectedAt),
          eq(sourceEnvironments.previewsEnabled, true),
          eq(sourceEnvironments.mappingRevision, sourceSyncs.mappingRevision),
        ),
      ),
  ]);
  if (!source || source.status !== "active") return { pullRequestNumbers: [] };
  const branches = [
    ...new Set(
      appRows
        .filter(
          (app) =>
            !isNormalizedResource(app.config) &&
            app.config.preview?.enabled === true,
        )
        .map((app) => app.branch),
    ),
  ];

  const [openPullRequestNumbers, existingEnvironments, existingReports] =
    await Promise.all([
      Promise.all(
        branches.map((branch) =>
          dependencies.listPullRequests({
            baseBranch: branch,
            installationId: source.installationId,
            repositoryName: source.repositoryName,
            repositoryOwner: source.repositoryOwner,
          }),
        ),
      ).then((results) => results.flat()),
      database
        .selectDistinct({
          pullRequestNumber: previewEnvironments.pullRequestNumber,
        })
        .from(previewEnvironments)
        .where(
          and(
            eq(previewEnvironments.sourceId, sourceId),
            ne(previewEnvironments.status, "deleted"),
          ),
        ),
      database
        .selectDistinct({
          pullRequestNumber: previewPullRequestReports.pullRequestNumber,
        })
        .from(previewPullRequestReports)
        .where(
          and(
            eq(previewPullRequestReports.sourceId, sourceId),
            isNull(previewPullRequestReports.closedAt),
          ),
        ),
    ]);
  const pullRequestNumbers = previewPullRequestsToReconcile(
    openPullRequestNumbers,
    [
      ...existingEnvironments.map(
        (environment) => environment.pullRequestNumber,
      ),
      ...existingReports.map((report) => report.pullRequestNumber),
    ],
  );
  for (let index = 0; index < pullRequestNumbers.length; index += 10) {
    await Promise.all(
      pullRequestNumbers
        .slice(index, index + 10)
        .map((pullRequestNumber) =>
          dependencies.enqueue({ pullRequestNumber, sourceId }),
        ),
    );
  }
  return { pullRequestNumbers };
}
