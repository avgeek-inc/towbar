import { cleanupPreviewRemoteScript } from "./remote-scripts.js";
import { SshSession } from "./ssh.js";

import type { PreviewCleanupContext, SshLoginSecret } from "./types.js";

export async function cleanupPreviewEnvironment(input: {
  context: PreviewCleanupContext;
  login: SshLoginSecret;
  signal?: AbortSignal;
}) {
  const session = await SshSession.connect({
    login: input.login,
    server: input.context.server,
    trustedHostKeys: input.context.trustedHostKeys,
  });
  try {
    await session.run(
      cleanupPreviewRemoteScript,
      [
        input.context.runtimeId,
        String(input.context.containerNames.length),
        ...input.context.containerNames,
        String(input.context.imageTags.length),
        ...input.context.imageTags,
      ],
      { signal: input.signal, timeoutMs: 180_000 },
    );
  } finally {
    await session.close().catch(() => undefined);
  }
}
