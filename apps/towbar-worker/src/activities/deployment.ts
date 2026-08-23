import { ApplicationFailure, Context } from "@temporalio/activity";

import {
  DeploymentCommitUncertainError,
  DeploymentCommittedError,
  HostKeyNotTrustedError,
  executeDeployment,
  finalizeInterruptedDeployment,
  rollbackInterruptedDeployment,
} from "@workspace/towbar-deployer";
import { terminalDeploymentStates } from "@workspace/towbar-core/temporal";

import { getEnv } from "../env.js";
import { signedApiRequest } from "../infrastructure/towbar-api.js";
import { releaseCommitPayload } from "./release-commit.js";

import type {
  DeploymentExecutionContext,
  DeploymentResult,
  DeploymentSecrets,
  ReleaseCommitResult,
} from "@workspace/towbar-deployer";
import type { DeploymentState } from "@workspace/towbar-core/temporal";

export async function markDeploymentWaitingActivity(deploymentId: string) {
  await recordEvent(deploymentId, {
    message: "Waiting for the target server queue",
    state: "waiting_for_server",
  });
}

export async function executeDeploymentActivity(deploymentId: string) {
  const activity = Context.current();
  let currentState = "waiting_for_server";
  const pulse = setInterval(
    () => activity.heartbeat({ state: currentState }),
    10_000,
  );
  try {
    const [contextResponse, secretsResponse] = await Promise.all([
      signedApiRequest<{ context: DeploymentExecutionContext }>(
        "GET",
        `/v1/internal/deployments/${deploymentId}/context`,
      ),
      signedApiRequest<{ secrets: DeploymentSecrets }>(
        "POST",
        `/v1/internal/deployments/${deploymentId}/secrets/resolve`,
      ),
    ]);
    await executeDeployment({
      context: contextResponse.context,
      deferCleanup: getEnv().TOWBAR_APP_ID === contextResponse.context.app.id,
      hooks: {
        commitRelease: async (result: DeploymentResult) => {
          return await signedApiRequest<ReleaseCommitResult>(
            "POST",
            `/v1/internal/deployments/${deploymentId}/releases/commit`,
            releaseCommitPayload(result),
          );
        },
        heartbeat: ({ state }) => {
          currentState = state;
          activity.heartbeat({ state });
        },
        log: async (content, stream) => {
          await recordEvent(deploymentId, { log: { content, stream } });
        },
        transition: async (state, message) => {
          await recordEvent(deploymentId, { message, state });
        },
      },
      secrets: secretsResponse.secrets,
      signal: activity.cancellationSignal,
    });
  } catch (error) {
    const cancelled = activity.cancellationSignal.aborted;
    if (
      !(error instanceof DeploymentCommittedError) &&
      !(error instanceof DeploymentCommitUncertainError)
    ) {
      await recordEvent(deploymentId, {
        errorCode: cancelled ? "DEPLOYMENT_CANCELLED" : classifyError(error),
        message: cancelled ? "Deployment cancelled" : safeErrorMessage(error),
        state: cancelled ? "cancelled" : "failed",
      }).catch(() => undefined);
    }
    throw ApplicationFailure.create({
      message: safeErrorMessage(error),
      nonRetryable: error instanceof HostKeyNotTrustedError,
      type: cancelled ? "Cancelled" : classifyError(error),
    });
  } finally {
    clearInterval(pulse);
  }
}

export async function continueAutomaticDeploymentsActivity(
  deploymentId: string,
) {
  await signedApiRequest(
    "POST",
    `/v1/internal/deployments/${deploymentId}/auto-deploy/continue`,
  );
}

export async function recoverDeploymentActivity(deploymentId: string) {
  const status = await signedApiRequest<{
    committed: boolean;
    retainedImageTags: string[];
    state: DeploymentState;
  }>("GET", `/v1/internal/deployments/${deploymentId}/recovery`);
  if (terminalDeploymentStates.has(status.state)) {
    return ["succeeded", "succeeded_with_warnings"].includes(status.state)
      ? "succeeded"
      : "failed";
  }

  if (status.committed) {
    if (status.state === "switching_traffic") {
      await recordEvent(deploymentId, {
        message: "Release was committed before the executor stopped",
        state: "cleaning_up",
      });
    }
    let cleanupPending = false;
    try {
      const [contextResponse, loginResponse] = await Promise.all([
        signedApiRequest<{ context: DeploymentExecutionContext }>(
          "GET",
          `/v1/internal/deployments/${deploymentId}/context`,
        ),
        signedApiRequest<{ login: DeploymentSecrets["login"] }>(
          "POST",
          `/v1/internal/deployments/${deploymentId}/secrets/login/resolve`,
        ),
      ]);
      await finalizeInterruptedDeployment({
        context: contextResponse.context,
        login: loginResponse.login,
        retainedImageTags: status.retainedImageTags,
      });
    } catch {
      cleanupPending = true;
    }
    await recordEvent(deploymentId, {
      message: cleanupPending
        ? "Deployment recovered; remote cleanup remains pending"
        : "Deployment recovered after executor interruption",
      state: "succeeded",
    });
    return "succeeded";
  }

  let cleanupPending = false;
  try {
    const [contextResponse, secretsResponse] = await Promise.all([
      signedApiRequest<{ context: DeploymentExecutionContext }>(
        "GET",
        `/v1/internal/deployments/${deploymentId}/context`,
      ),
      signedApiRequest<{ secrets: DeploymentSecrets }>(
        "POST",
        `/v1/internal/deployments/${deploymentId}/secrets/resolve`,
      ),
    ]);
    await rollbackInterruptedDeployment({
      context: contextResponse.context,
      login: secretsResponse.secrets.login,
    });
  } catch {
    cleanupPending = true;
  }
  await recordEvent(deploymentId, {
    errorCode: cleanupPending
      ? "DEPLOYMENT_INTERRUPTED_CLEANUP_PENDING"
      : "DEPLOYMENT_INTERRUPTED",
    message: cleanupPending
      ? "Deployment executor stopped; remote cleanup is still required"
      : "Deployment executor stopped and its candidate was removed",
    state: "failed",
  });
  return "failed";
}

async function recordEvent(deploymentId: string, body: unknown) {
  await signedApiRequest(
    "POST",
    `/v1/internal/deployments/${deploymentId}/events`,
    body,
  );
}

function classifyError(error: unknown) {
  if (error instanceof DeploymentCommitUncertainError) {
    return "DEPLOYMENT_COMMIT_UNCERTAIN";
  }
  if (error instanceof DeploymentCommittedError) return "DEPLOYMENT_COMMITTED";
  if (error instanceof HostKeyNotTrustedError) return "HOST_KEY_NOT_TRUSTED";
  if (error instanceof Error && error.name === "AbortError") {
    return "DEPLOYMENT_CANCELLED";
  }
  return "DEPLOYMENT_FAILED";
}

function safeErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return "Deployment failed";
  return error.message
    .replace(/Bearer\s+\S+/giu, "Bearer [REDACTED]")
    .slice(0, 1_000);
}
