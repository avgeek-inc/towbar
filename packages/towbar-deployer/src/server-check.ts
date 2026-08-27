import { HostKeyNotTrustedError, SshSession, scanHostKeys } from "./ssh.js";
import { inspectServerRuntime } from "./runtime-inspection.js";

import type { ServerCheckContext, ServerCheckResult } from "./types.js";

const preflightScript = String.raw`
set -euo pipefail
requires_cloudflare="$1"
. /etc/os-release
test "$ID" = ubuntu
command -v docker >/dev/null
docker version --format '{{.Server.Version}}' >/tmp/towbar-docker-version
command -v caddy >/dev/null
if test "$requires_cloudflare" = true; then caddy list-modules | grep -Fx dns.providers.cloudflare >/dev/null; fi
sudo -n /usr/bin/test -d /etc/caddy
printf '%s\n' "$PRETTY_NAME" "$(cat /tmp/towbar-docker-version)" "$(caddy version | awk '{print $1}')" "$(df -Pk /var/lib/docker | awk 'NR==2 {print $4}')"
rm -f /tmp/towbar-docker-version
`;

export async function checkServer(
  context: ServerCheckContext,
): Promise<ServerCheckResult> {
  const discovered = await scanHostKeys(context.config);
  if (context.trustedHostKeys.length === 0) {
    throw new HostKeyNotTrustedError(discovered);
  }
  const session = await SshSession.connect({
    login: context.login,
    server: context.config,
    trustedHostKeys: context.trustedHostKeys,
  });
  try {
    const { stdout } = await session.run(
      preflightScript,
      [String(Boolean(context.config.proxy?.cloudflare))],
      {
        timeoutMs: 30_000,
      },
    );
    const [operatingSystem, dockerVersion, caddyVersion, diskAvailable] = stdout
      .trim()
      .split("\n");
    if (!operatingSystem || !dockerVersion || !caddyVersion || !diskAvailable) {
      throw new Error("Server preflight returned an incomplete result");
    }
    const inspection = await inspectServerRuntime({
      containerNames: context.expectedContainerNames,
      deployables: context.expectedDeployables,
      imageTags: context.expectedImageTags,
      session,
      sourceId: context.sourceId,
    });
    return {
      caddyVersion,
      diskAvailableKb: Number(diskAvailable),
      dockerVersion,
      hostKey: context.trustedHostKeys[0]!,
      operatingSystem,
      ...inspection,
    };
  } finally {
    await session.close();
  }
}
