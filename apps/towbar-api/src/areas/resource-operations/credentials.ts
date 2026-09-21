import { conflict } from "../../http/errors.js";
import { hasAwsCredentials } from "../aws/service.js";
import { hasGcpCredentials } from "../gcp/service.js";
import { hasAzureCredentials } from "../azure/service.js";

export async function requireBackupCredentials(
  workspaceId: string,
  providers: { s3?: boolean; gcs?: boolean; azureBlob?: boolean },
) {
  for (const [enabled, name, code, configured] of [
    [providers.s3, "AWS", "AWS_NOT_CONFIGURED", hasAwsCredentials],
    [providers.gcs, "Google Cloud", "GCP_NOT_CONFIGURED", hasGcpCredentials],
    [providers.azureBlob, "Azure", "AZURE_NOT_CONFIGURED", hasAzureCredentials],
  ] as const) {
    if (enabled && !(await configured(workspaceId)))
      throw conflict(
        `Configure ${name} in Integrations before running backups or restores`,
        code,
      );
  }
}
