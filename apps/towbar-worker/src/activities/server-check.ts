import { ApplicationFailure, Context } from "@temporalio/activity";

import {
  HostKeyNotTrustedError,
  checkServer,
} from "@workspace/towbar-deployer";

import { signedApiRequest } from "../infrastructure/towbar-api.js";

import type { ServerCheckContext } from "@workspace/towbar-deployer";

export async function executeServerCheckActivity(checkId: string) {
  const activity = Context.current();
  const pulse = setInterval(() => activity.heartbeat({ checkId }), 10_000);
  try {
    const response = await signedApiRequest<{ context: ServerCheckContext }>(
      "GET",
      `/v1/internal/server-checks/${checkId}/context`,
    );
    const result = await checkServer(response.context);
    await signedApiRequest(
      "POST",
      `/v1/internal/server-checks/${checkId}/events`,
      { result, status: "succeeded" },
    );
  } catch (error) {
    const result =
      error instanceof HostKeyNotTrustedError
        ? { discoveredHostKeys: error.discovered }
        : undefined;
    await signedApiRequest(
      "POST",
      `/v1/internal/server-checks/${checkId}/events`,
      {
        errorCode:
          error instanceof HostKeyNotTrustedError
            ? "HOST_KEY_NOT_TRUSTED"
            : "SERVER_CHECK_FAILED",
        errorMessage: safeErrorMessage(error),
        ...(result ? { result } : {}),
        status: "failed",
      },
    );
    throw ApplicationFailure.create({
      message: safeErrorMessage(error),
      nonRetryable: error instanceof HostKeyNotTrustedError,
      type:
        error instanceof HostKeyNotTrustedError
          ? "HostKeyNotTrusted"
          : "ServerCheckFailed",
    });
  } finally {
    clearInterval(pulse);
  }
}

function safeErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message.slice(0, 1_000)
    : "Server check failed";
}
