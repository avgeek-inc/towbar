export type TowbarUpgradeJob = {
  id: string;
  planId: string;
  currentVersion: string;
  targetVersion: string;
  commit: string;
  state:
    | "checking"
    | "downloading"
    | "applying"
    | "verifying"
    | "restoring"
    | "succeeded"
    | "blocked"
    | "failed"
    | "interrupted"
    | "recovered";
  message: string;
  blockers: string[];
  updatedAt: number;
};
export type TowbarUpgradeStatus = {
  supported: boolean;
  reason?: string;
  job: TowbarUpgradeJob | null;
};
export type TowbarUpgradePlan = {
  id: string;
  currentVersion: string;
  targetVersion: string;
  commit: string;
  releaseUrl: string;
  releaseNotes: string;
  blockers: string[];
  expiresAt: number;
};
