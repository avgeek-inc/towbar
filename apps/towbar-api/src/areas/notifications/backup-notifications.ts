import type { BackupAssuranceStatus } from "@workspace/towbar-core";

export function backupFailedNotificationCopy(resourceName: string) {
  return {
    message: `Towbar could not complete the ${resourceName} backup. Check the latest backup attempt in Towbar.`,
    title: "Backup failed",
  };
}

export function backupStaleNotificationCopy(
  resourceName: string,
  occurrence: Date,
) {
  return {
    details: { scheduled_for: formatUtcDate(occurrence) },
    message: `Towbar did not finish the scheduled backup for ${resourceName}. Check the latest backup attempt in Towbar.`,
    title: "Scheduled backup did not complete",
  };
}

export function backupNotRestorableNotificationCopy(resourceName: string) {
  return {
    message: `Towbar cannot confirm that the latest ${resourceName} backup is safe to restore. Check Backup health in Towbar before relying on it.`,
    title: "Backup cannot be verified",
  };
}

export function shouldEmitBackupNotRestorableNotification(
  status: BackupAssuranceStatus,
  previousStatus?: BackupAssuranceStatus,
) {
  return status === "not_restore_ready" && previousStatus !== status;
}

function formatUtcDate(value: Date) {
  const day = value.getUTCDate();
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][value.getUTCMonth()];
  const year = value.getUTCFullYear();
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} at ${hour}:${minute} UTC`;
}
