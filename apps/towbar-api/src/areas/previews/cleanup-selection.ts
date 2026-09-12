export function selectObsoletePreviewApps(input: {
  existing: {
    appId: string;
    environmentId: string | null;
    archived: boolean;
    enabled: boolean;
  }[];
  targetEnvironmentIds: string[];
  evaluatedAppIds: string[];
  relevantAppIds: string[];
}) {
  const targets = new Set(input.targetEnvironmentIds);
  const evaluated = new Set(input.evaluatedAppIds);
  const relevant = new Set(input.relevantAppIds);
  return [
    ...new Set(
      input.existing
        .filter(
          (app) =>
            !app.environmentId ||
            !targets.has(app.environmentId) ||
            app.archived ||
            !app.enabled ||
            (evaluated.has(app.appId) && !relevant.has(app.appId)),
        )
        .map((app) => app.appId),
    ),
  ];
}
