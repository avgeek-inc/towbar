import { signedApiRequest } from "../infrastructure/towbar-api.js";
import { Context } from "@temporalio/activity";
import {
  cleanupPreviewEnvironment,
  deleteCloudflarePreviewDns,
} from "@workspace/towbar-deployer";

import type { PreviewPullRequestEvent } from "@workspace/towbar-core/temporal";
import type {
  PreviewCleanupContext,
  SshLoginSecret,
} from "@workspace/towbar-deployer";

export async function processPreviewPullRequestEventActivity(
  event: PreviewPullRequestEvent,
) {
  const activity = Context.current();
  const pulse = setInterval(
    () =>
      activity.heartbeat({
        pullRequestNumber: event.pullRequestNumber,
        sourceId: event.sourceId,
      }),
    10_000,
  );
  try {
    return await signedApiRequest<{
      cleanupIds: string[];
      deploymentIds: string[];
      retry: boolean;
    }>("POST", "/v1/internal/previews/events", event, { timeoutMs: 120_000 });
  } finally {
    clearInterval(pulse);
  }
}

export async function executePreviewCleanupActivity(
  previewEnvironmentId: string,
) {
  const [contextResponse, secrets] = await Promise.all([
    signedApiRequest<{
      context: PreviewCleanupContext;
      latestDeploymentId: string | null;
    }>("GET", `/v1/internal/previews/${previewEnvironmentId}/cleanup/context`),
    signedApiRequest<{
      cloudflare: { apiToken: string } | null;
      login: SshLoginSecret;
    }>(
      "POST",
      `/v1/internal/previews/${previewEnvironmentId}/cleanup/secrets/resolve`,
    ),
  ]);
  try {
    await cleanupPreviewEnvironment({
      context: contextResponse.context,
      login: secrets.login,
    });
    if (secrets.cloudflare) {
      await deleteCloudflarePreviewDns({
        apiToken: secrets.cloudflare.apiToken,
        appId: contextResponse.context.runtimeId,
        hostname: contextResponse.context.hostname,
      });
    }
    await recordCleanupResult(previewEnvironmentId, { succeeded: true });
  } catch (error) {
    await recordCleanupResult(previewEnvironmentId, {
      errorMessage: safeErrorMessage(error),
      succeeded: false,
    }).catch(() => undefined);
    throw error;
  }
}

async function recordCleanupResult(
  previewEnvironmentId: string,
  result: { errorMessage?: string; succeeded: boolean },
) {
  await signedApiRequest(
    "POST",
    `/v1/internal/previews/${previewEnvironmentId}/cleanup/result`,
    result,
  );
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
        .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
        .slice(0, 1_000)
    : "Preview cleanup failed";
}
