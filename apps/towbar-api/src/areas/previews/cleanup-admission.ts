export type ClaimedPreviewCleanup = {
  appId: string;
  id: string;
  serverId: string;
};

export type PreviewCleanupServer = {
  buildConcurrency: number;
  ip: string;
  previewBuildConcurrency: number;
};

export async function enqueueClaimedPreviewCleanups(input: {
  enqueue: (
    environment: ClaimedPreviewCleanup,
    server: PreviewCleanupServer,
  ) => Promise<void>;
  environments: ClaimedPreviewCleanup[];
  markFailed: (
    environment: ClaimedPreviewCleanup,
    error: unknown,
  ) => Promise<void>;
  serverById: ReadonlyMap<string, PreviewCleanupServer>;
}) {
  const failures: unknown[] = [];
  for (const environment of input.environments) {
    try {
      const server = input.serverById.get(environment.serverId);
      if (!server) throw new Error("Preview cleanup server was not found");
      await input.enqueue(environment, server);
    } catch (error) {
      failures.push(error);
      try {
        await input.markFailed(environment, error);
      } catch (recordingError) {
        failures.push(recordingError);
      }
    }
  }
  if (failures.length > 0) throw failures[0];
}

export function previewCleanupAdmissionFailureMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1_000)
    : "Preview cleanup queue is unavailable";
}
