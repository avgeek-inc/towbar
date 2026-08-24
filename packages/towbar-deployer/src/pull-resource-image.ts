import { isNormalizedResource } from "@workspace/towbar-core";

import { runWithSafeLogs, transition } from "./executor-hooks.js";

import type { SshSession } from "./ssh.js";
import type { DeploymentExecutionContext, ExecutorHooks } from "./types.js";

export const pullResourceImageScript =
  'set -euo pipefail\nbase_image="$1"\nimage_tag="$2"\nsource_id="$3"\ndeployable_id="$4"\nmanifest_id="$5"\ndocker pull "$base_image"\nprintf \'ARG BASE_IMAGE=busybox:stable\\nFROM ${BASE_IMAGE}\\n\' | docker build --build-arg "BASE_IMAGE=$base_image" --label "towbar.managed=true" --label "towbar.app=$manifest_id" --label "towbar.deployable=$deployable_id" --label "towbar.source=$source_id" -t "$image_tag" -\ndocker image rm "$base_image" >/dev/null 2>&1 || true';

export async function pullResourceImage(input: {
  context: DeploymentExecutionContext;
  hooks: ExecutorHooks;
  imageTag: string;
  sensitiveValues: string[];
  session: SshSession;
  signal?: AbortSignal;
}) {
  const resource = isNormalizedResource(input.context.app)
    ? input.context.app
    : null;
  if (!resource) throw new Error("Resource image configuration is missing");
  await transition(input.hooks, "transferring", "Runtime configuration ready");
  await transition(input.hooks, "building", "Pulling pinned Docker image");
  await runWithSafeLogs({
    hooks: input.hooks,
    run: async (outputHandlers) =>
      await input.session.run(
        pullResourceImageScript,
        [
          resource.image,
          input.imageTag,
          input.context.sourceId,
          input.context.deployableId,
          resource.id,
        ],
        {
          ...outputHandlers,
          signal: input.signal,
          timeoutMs: 15 * 60_000,
        },
      ),
    sensitiveValues: input.sensitiveValues,
  });
}
