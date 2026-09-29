import { deploymentCloudflareDnsDomains } from "@workspace/towbar-core";

import { unprocessable } from "../../http/errors.js";
import { getRuntimeIntegration } from "../../infrastructure/runtime-integrations.js";

export function cloudflareDnsCredential(
  deployable: Parameters<typeof deploymentCloudflareDnsDomains>[0],
  connection = getRuntimeIntegration("cloudflare"),
) {
  const usesDns = deployable.services
    ? deploymentCloudflareDnsDomains(deployable).length > 0
    : deployable.tls?.mode === "cloudflare-dns";
  if (!usesDns) return null;
  if (!connection || connection.provider !== "cloudflare")
    throw unprocessable(
      "Configure Cloudflare in the Towbar runtime before deploying with tls.mode: cloudflare-dns",
      "CLOUDFLARE_CREDENTIALS_MISSING",
    );
  return { apiToken: connection.credentials.apiToken };
}
