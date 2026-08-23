export type DependencyReleaseState = {
  archivedAt: Date | null;
  currentDeploymentDigest: string | null;
  desiredDeploymentDigest: string | null;
  manifestId: string;
};

export function findUnavailableAppDependencies(input: {
  dependencyIds: string[];
  releases: DependencyReleaseState[];
}) {
  const byManifestId = new Map(
    input.releases.map((release) => [release.manifestId, release]),
  );
  return input.dependencyIds.filter((dependencyId) => {
    const dependency = byManifestId.get(dependencyId);
    return (
      !dependency ||
      Boolean(dependency.archivedAt) ||
      !dependency.desiredDeploymentDigest ||
      dependency.currentDeploymentDigest !== dependency.desiredDeploymentDigest
    );
  });
}

export async function requireSatisfiedAppDependencies(input: {
  app: (typeof apps.$inferSelect)["config"];
  sourceId: string;
  workspaceId: string;
}) {
  const dependencyIds = input.app.dependsOn ?? [];
  if (dependencyIds.length === 0) return;
  const rows = await getTowbarDatabase()
    .select({
      archivedAt: apps.archivedAt,
      currentDeploymentDigest: releases.deploymentDigest,
      desiredDeploymentDigest: apps.deploymentDigest,
      manifestId: apps.manifestId,
    })
    .from(apps)
    .leftJoin(
      releases,
      and(eq(releases.appId, apps.id), eq(releases.status, "current")),
    )
    .where(
      and(
        eq(apps.workspaceId, input.workspaceId),
        eq(apps.sourceId, input.sourceId),
        inArray(apps.manifestId, dependencyIds),
      ),
    );
  const unavailable = findUnavailableAppDependencies({
    dependencyIds,
    releases: rows,
  });
  if (unavailable.length > 0) {
    throw conflict(
      `Deploy required dependencies first: ${unavailable.join(", ")}`,
      "APP_DEPENDENCY_NOT_READY",
    );
  }
}
import { and, eq, inArray } from "drizzle-orm";

import { apps, releases } from "@workspace/towbar-database/schema";

import { conflict } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
