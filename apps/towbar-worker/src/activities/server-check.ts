import { ApplicationFailure, Context } from "@temporalio/activity";

import {
  CommandError,
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

export async function markServerCheckInterruptedActivity(checkId: string) {
  await signedApiRequest(
    "POST",
    `/v1/internal/server-checks/${checkId}/interrupt`,
  );
}

export function safeErrorMessage(error: unknown) {
  if (error instanceof CommandError) {
    if (/permission denied \(publickey(?:,[^)]+)?\)/iu.test(error.stderr))
      return "SSH authentication failed. The selected private key is not authorized for the configured SSH username.";
    if (
      /connection (?:timed out|timeout)|operation timed out/iu.test(
        error.stderr,
      )
    )
      return "The SSH connection timed out. Check the server address, SSH port, and firewall rules.";
    if (/connection refused/iu.test(error.stderr))
      return "The server refused the SSH connection. Check the SSH port and that the SSH service is running.";
    if (/no route to host/iu.test(error.stderr))
      return "The server could not be reached over SSH. Check its network and firewall rules.";
    return "The SSH check failed before the server returned a diagnostic. Verify the selected private key, SSH username, SSH port, and firewall rules, then try again.";
  }
  return error instanceof Error
    ? error.message.slice(0, 1_000)
    : "Server check failed";
}
