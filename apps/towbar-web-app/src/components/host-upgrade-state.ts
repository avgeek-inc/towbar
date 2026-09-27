export function upgradeIsActive(state?: string) {
  return Boolean(
    state &&
    ["checking", "downloading", "applying", "verifying", "restoring"].includes(
      state,
    ),
  );
}
export function upgradeNeedsRecovery(state?: string) {
  return state === "failed" || state === "interrupted";
}
import type { TowbarUpgradeJob } from "@workspace/towbar-web-client";

export function upgradeCanReview(
  targetVersion: string | null | undefined,
  job?: Pick<TowbarUpgradeJob, "state" | "targetVersion">,
) {
  if (
    !targetVersion ||
    upgradeIsActive(job?.state) ||
    upgradeNeedsRecovery(job?.state)
  )
    return false;
  if (!job || job.state === "blocked" || job.state === "recovered") return true;
  if (job.state !== "succeeded") return false;
  const target = stableVersionParts(targetVersion);
  const completed = stableVersionParts(job.targetVersion);
  if (!target || !completed) return false;
  for (let index = 0; index < 3; index++) {
    if (target[index] !== completed[index])
      return target[index]! > completed[index]!;
  }
  return false;
}

function stableVersionParts(value: string) {
  return /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
    .exec(value)
    ?.slice(1)
    .map(BigInt);
}
