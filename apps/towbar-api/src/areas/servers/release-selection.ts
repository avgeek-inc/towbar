type RetainedRelease = {
  appId: string;
  environment: "preview" | "production";
  status: "current" | "previous" | "superseded";
};

export function selectCurrentProductionReleaseByDeployable<
  Release extends RetainedRelease,
>(releases: Release[]) {
  return new Map(
    releases
      .filter(
        (release) =>
          release.environment === "production" && release.status === "current",
      )
      .map((release) => [release.appId, release] as const),
  );
}

export function selectCurrentContainerNames<Release extends RetainedRelease>(
  releases: Array<Release & { containerName: string }>,
) {
  return releases
    .filter((release) => release.status === "current")
    .map((release) => release.containerName);
}
