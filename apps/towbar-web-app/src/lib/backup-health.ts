import type {
  BackupAssurance,
  ResourceOperation,
  SourceBackup,
} from "@workspace/towbar-web-client";

type BackupOperation = Pick<ResourceOperation, "errorMessage" | "state">;
type RetainedBackup = Pick<SourceBackup, "id">;

export type BackupHealthTone =
  "destructive" | "secondary" | "success" | "warning";

export type BackupHealthStage = {
  description: string;
  label: string;
  status: string;
  tone: BackupHealthTone;
};

export type BackupHealth = {
  description: string;
  label: string;
  stages: BackupHealthStage[];
  title: string;
  tone: BackupHealthTone;
};

export function getBackupHealth(input: {
  assurance?: BackupAssurance;
  latestBackup?: RetainedBackup;
  latestOperation?: BackupOperation;
}): BackupHealth {
  const { assurance, latestBackup, latestOperation } = input;
  const base = {
    stages: getBackupHealthStages(input),
  };

  if (
    latestOperation?.state === "queued" ||
    latestOperation?.state === "running"
  ) {
    return {
      ...base,
      description: "Towbar is creating and checking a new backup.",
      label: "In progress",
      title: "Backup in progress",
      tone: "warning",
    };
  }

  if (latestOperation?.state === "failed") {
    return {
      ...base,
      description:
        "Towbar could not finish the latest backup. Check the operation, then run another backup.",
      label: "Needs attention",
      title: "Backup failed",
      tone: "destructive",
    };
  }

  if (latestOperation?.state === "cancelled") {
    return {
      ...base,
      description: "The latest backup was cancelled before it finished.",
      label: "Cancelled",
      title: "Backup was cancelled",
      tone: "warning",
    };
  }

  if (!latestBackup) {
    if (latestOperation?.state === "succeeded") {
      return {
        ...base,
        description: "The backup finished and its saved file is being checked.",
        label: "Checking",
        title: "Checking backup",
        tone: "warning",
      };
    }
    return {
      ...base,
      description: "Run a backup to create the first restore point.",
      label: "No backup",
      title: "No backup yet",
      tone: "secondary",
    };
  }

  if (!assurance) {
    return {
      ...base,
      description: "Towbar is checking the saved backup file.",
      label: "Checking",
      title: "Checking backup",
      tone: "warning",
    };
  }

  if (assurance.restoreReady) {
    return {
      ...base,
      description:
        "The latest backup is stored, verified, and ready to restore.",
      label: "Healthy",
      title: "Backup is healthy",
      tone: "success",
    };
  }

  if (assurance.status === "stale") {
    return {
      ...base,
      description: "The latest saved backup is too old. Run a new backup.",
      label: "Needs attention",
      title: "Backup is out of date",
      tone: "destructive",
    };
  }

  return {
    ...base,
    description: friendlyAssuranceFailure(assurance.checks),
    label: "Needs attention",
    title: "Backup cannot be verified",
    tone: "destructive",
  };
}

function getBackupHealthStages(input: {
  assurance?: BackupAssurance;
  latestBackup?: RetainedBackup;
  latestOperation?: BackupOperation;
}): BackupHealthStage[] {
  const { assurance, latestBackup, latestOperation } = input;
  const objectCheck = assurance?.checks.find(
    (check) => check.name === "object_exists",
  );
  const sizeCheck = assurance?.checks.find((check) => check.name === "size");
  const savedFileVerified = objectCheck?.passed && sizeCheck?.passed;

  return [
    operationStage(latestOperation, latestBackup),
    !latestBackup
      ? {
          description: "Waiting for the first completed backup.",
          label: "S3 copy",
          status: "Waiting",
          tone: "secondary",
        }
      : !assurance
        ? {
            description: "Towbar has not checked the saved file yet.",
            label: "S3 copy",
            status: "Waiting",
            tone: "secondary",
          }
        : savedFileVerified
          ? {
              description: "The saved backup file is readable.",
              label: "S3 copy",
              status: "Verified",
              tone: "success",
            }
          : {
              description: friendlyS3Failure(assurance.checks),
              label: "S3 copy",
              status: "Cannot verify",
              tone: "destructive",
            },
    assurance?.restoreReady
      ? {
          description: "The saved backup is ready to restore.",
          label: "Restore check",
          status: "Ready",
          tone: "success",
        }
      : assurance
        ? {
            description: "Do not rely on this backup for a restore yet.",
            label: "Restore check",
            status: "Not ready",
            tone: "destructive",
          }
        : {
            description: "Waiting for the saved file check.",
            label: "Restore check",
            status: "Waiting",
            tone: "secondary",
          },
  ];
}

function operationStage(
  operation?: BackupOperation,
  latestBackup?: RetainedBackup,
): BackupHealthStage {
  if (!operation) {
    return latestBackup
      ? {
          description: "Towbar completed the last retained backup.",
          label: "Backup run",
          status: "Complete",
          tone: "success",
        }
      : {
          description: "No backup has been started.",
          label: "Backup run",
          status: "Not started",
          tone: "secondary",
        };
  }
  if (operation.state === "queued" || operation.state === "running") {
    return {
      description:
        operation.state === "queued"
          ? "Waiting to start."
          : "Towbar is creating the backup.",
      label: "Backup run",
      status: "In progress",
      tone: "warning",
    };
  }
  if (operation.state === "succeeded") {
    return {
      description: "Towbar completed the backup.",
      label: "Backup run",
      status: "Complete",
      tone: "success",
    };
  }
  return {
    description:
      operation.state === "cancelled"
        ? "The backup was cancelled."
        : "Towbar could not complete this run.",
    label: "Backup run",
    status: operation.state === "cancelled" ? "Cancelled" : "Failed",
    tone: operation.state === "cancelled" ? "warning" : "destructive",
  };
}

function friendlyS3Failure(checks: BackupAssurance["checks"]) {
  const objectCheck = checks.find((check) => check.name === "object_exists");
  if (objectCheck?.message.toLowerCase().includes("cannot access")) {
    return "Towbar cannot read the saved file. Check the workspace AWS permissions.";
  }
  if (objectCheck && !objectCheck.passed) {
    return objectCheck.message.toLowerCase().includes("unavailable")
      ? "The S3 check is temporarily unavailable."
      : "Towbar cannot find the saved file in S3.";
  }
  return "Towbar could not verify the saved backup file.";
}

function friendlyAssuranceFailure(checks: BackupAssurance["checks"]) {
  const failedNames = new Set(
    checks.filter((check) => !check.passed).map((check) => check.name),
  );
  if (failedNames.has("object_exists") || failedNames.has("size")) {
    return friendlyS3Failure(checks);
  }
  if (failedNames.has("checksum")) {
    return "The saved backup file did not pass its integrity check. Run a new backup.";
  }
  if (failedNames.has("encryption")) {
    return "Towbar could not verify the backup's encryption settings.";
  }
  if (failedNames.has("engine") || failedNames.has("format")) {
    return "The saved backup does not match this database. Run a new backup.";
  }
  return "Towbar could not verify the latest saved backup.";
}
