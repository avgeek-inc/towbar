import { Cron } from "croner";

export const autoDeployRecoveryPolicies = [
  "manual",
  "on_manual_success",
] as const;

export type AutoDeployRecoveryPolicy =
  (typeof autoDeployRecoveryPolicies)[number];

export type AutoDeployMaintenanceWindow = {
  daysOfWeek: number[];
  endMinute: number;
  startMinute: number;
  timezone: string;
};

export type AutoDeployControl = {
  failureThreshold: number;
  maintenanceWindow: AutoDeployMaintenanceWindow | null;
  paused: boolean;
  pausedAt: string | null;
  pausedBy: string | null;
  pauseReason: string | null;
  recoveryPolicy: AutoDeployRecoveryPolicy;
  updatedAt: string | null;
  updatedBy: string | null;
};

export type AutoDeployCircuit = {
  consecutiveFailures: number;
  failureFingerprint: string | null;
  openedAt: string | null;
  openedReason: string | null;
};

export type DeferredAutomaticDeployment = {
  commitSha: string;
  deploymentDigest: string;
  deferredAt: string;
  manifestId: string;
  nextEligibleAt: string | null;
  reason: AutoDeployBlockReason;
  scope: "deployable" | "source";
};

export type AutoDeployBlockReason =
  "circuit_open" | "maintenance_window" | "paused";

export const defaultAutoDeployControl: AutoDeployControl = {
  failureThreshold: 3,
  maintenanceWindow: null,
  paused: false,
  pausedAt: null,
  pausedBy: null,
  pauseReason: null,
  recoveryPolicy: "manual",
  updatedAt: null,
  updatedBy: null,
};

export const defaultAutoDeployCircuit: AutoDeployCircuit = {
  consecutiveFailures: 0,
  failureFingerprint: null,
  openedAt: null,
  openedReason: null,
};

export function evaluateMaintenanceWindow(
  window: AutoDeployMaintenanceWindow | null,
  now = new Date(),
): { nextOpenAt: string | null; open: boolean } {
  if (!window) return { nextOpenAt: null, open: true };
  const local = getZonedParts(now, window.timezone);
  const localMinute = local.hour * 60 + local.minute;
  const configuredToday = window.daysOfWeek.includes(local.dayOfWeek);
  const configuredYesterday = window.daysOfWeek.includes(
    (local.dayOfWeek + 6) % 7,
  );
  const crossesMidnight = window.endMinute <= window.startMinute;
  const open = crossesMidnight
    ? (configuredToday && localMinute >= window.startMinute) ||
      (configuredYesterday && localMinute < window.endMinute)
    : configuredToday &&
      localMinute >= window.startMinute &&
      localMinute < window.endMinute;
  if (open) return { nextOpenAt: null, open: true };

  const startHour = Math.floor(window.startMinute / 60);
  const startMinute = window.startMinute % 60;
  const nextRun = new Cron(
    `${startMinute} ${startHour} * * ${window.daysOfWeek.join(",")}`,
    { timezone: window.timezone },
  ).nextRun(now);
  return { nextOpenAt: nextRun?.toISOString() ?? null, open: false };
}

export function validateAutoDeployMaintenanceWindow(
  window: AutoDeployMaintenanceWindow,
) {
  if (
    window.daysOfWeek.length === 0 ||
    window.daysOfWeek.some(
      (day) => !Number.isInteger(day) || day < 0 || day > 6,
    )
  ) {
    throw new Error("Select at least one valid maintenance-window day");
  }
  if (
    !Number.isInteger(window.startMinute) ||
    window.startMinute < 0 ||
    window.startMinute > 1_439 ||
    !Number.isInteger(window.endMinute) ||
    window.endMinute < 0 ||
    window.endMinute > 1_439
  ) {
    throw new Error("Maintenance-window times must be minute-of-day values");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: window.timezone }).format();
  } catch {
    throw new Error("Maintenance-window timezone is invalid");
  }
}

function getZonedParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hourCycle: "h23",
    minute: "numeric",
    timeZone: timezone,
    weekday: "short",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    dayOfWeek: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
      values.weekday ?? "",
    ),
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}
