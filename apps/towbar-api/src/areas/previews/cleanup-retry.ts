const cleanupRetryDelaysMinutes = [5, 15, 60, 360] as const;

export function nextPreviewCleanupAttemptAt(
  attempts: number,
  now = new Date(),
) {
  const delay =
    cleanupRetryDelaysMinutes[
      Math.min(Math.max(attempts - 1, 0), cleanupRetryDelaysMinutes.length - 1)
    ] ?? cleanupRetryDelaysMinutes.at(-1)!;
  return new Date(now.getTime() + delay * 60_000);
}
