type ImageRelease = { imageTag: string };
type RollbackReservation = {
  rollbackReleaseSnapshot: { imageTag: string } | null;
};

/**
 * Retain the images that PostgreSQL still exposes as rollback targets. A
 * queued rollback reserves its immutable image even if a newer deployment
 * changes the current/previous release pair before that rollback executes.
 */
export function collectRetainedImageTags(
  releases: ImageRelease[],
  rollbackReservations: RollbackReservation[],
) {
  return [
    ...new Set([
      ...releases.map(({ imageTag }) => imageTag),
      ...rollbackReservations.flatMap(({ rollbackReleaseSnapshot }) =>
        rollbackReleaseSnapshot ? [rollbackReleaseSnapshot.imageTag] : [],
      ),
    ]),
  ].sort();
}
