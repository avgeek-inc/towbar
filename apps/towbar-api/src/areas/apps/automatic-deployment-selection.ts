import { findUnavailableAppDependencies } from "./dependencies.js";

import type { DependencyReleaseState } from "./dependencies.js";

type AutomaticDeploymentCandidate = {
  archivedAt: Date | null;
  config: {
    autoDeploy?: boolean;
    dependsOn?: string[];
  };
  deploymentDigest: string | null;
  manifestId: string;
  kind: "app" | "image" | "postgres" | "redis";
  sourceRevision: string | null;
};

export function selectAutomaticDeploymentCandidates<
  Candidate extends AutomaticDeploymentCandidate,
>(input: {
  candidates: Candidate[];
  commitSha: string;
  releases: DependencyReleaseState[];
}) {
  const currentReleaseByApp = new Map(
    input.releases.map((release) => [release.manifestId, release]),
  );
  return input.candidates.filter(
    (candidate) =>
      Boolean(candidate.config.autoDeploy) &&
      Boolean(candidate.deploymentDigest) &&
      !candidate.archivedAt &&
      candidate.sourceRevision === input.commitSha &&
      !isCandidateCurrent(
        candidate,
        currentReleaseByApp.get(candidate.manifestId),
      ) &&
      findUnavailableAppDependencies({
        dependencyIds: candidate.config.dependsOn ?? [],
        releases: input.releases,
      }).length === 0,
  );
}

function isCandidateCurrent(
  candidate: AutomaticDeploymentCandidate,
  release: DependencyReleaseState | undefined,
) {
  return Boolean(
    release &&
    candidate.deploymentDigest &&
    release.currentDeploymentDigest === candidate.deploymentDigest,
  );
}
