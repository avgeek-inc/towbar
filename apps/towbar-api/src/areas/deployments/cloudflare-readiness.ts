import type { NormalizedDeployable } from "@workspace/towbar-core";

import { unprocessable } from "../../http/errors.js";
import { getRuntimeIntegration } from "../../infrastructure/runtime-integrations.js";

export function cloudflareDnsCredential(
  deployable: Pick<NormalizedDeployable, "tls">,
  connection = getRuntimeIntegration("cloudflare"),
) {
  if (deployable.tls?.mode !== "cloudflare-dns") return null;
  if (!connection || connection.provider !== "cloudflare")
    throw unprocessable(
      "Configure Cloudflare in the Towbar runtime before deploying with tls.mode: cloudflare-dns",
      "CLOUDFLARE_CREDENTIALS_MISSING",
    );
  return { apiToken: connection.credentials.apiToken };
}
