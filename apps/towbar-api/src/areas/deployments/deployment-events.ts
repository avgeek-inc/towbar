import { desc, eq, max } from "drizzle-orm";

import {
  assertDeploymentTransition,
  terminalDeploymentStates,
} from "@workspace/towbar-core/temporal";
import {
  deploymentLogChunks,
  deploymentSteps,
  deployments,
} from "@workspace/towbar-database/schema";

import { notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { propagatePreviewDeploymentState } from "./preview-status.js";
import { emitDeploymentNotification } from "../notifications/events.js";

import type { DeploymentState } from "@workspace/towbar-core/temporal";

export async function recordDeploymentEvent(
  deploymentId: string,
  input: {
    errorCode?: string;
    log?: { content: string; stream: "stderr" | "stdout" };
    message?: string;
    state?: DeploymentState;
  },
) {
  const result = await getTowbarDatabase().transaction(async (transaction) => {
    const [deployment] = await transaction
      .select({ state: deployments.state })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .for("update")
      .limit(1);
    if (!deployment) throw notFound("Deployment");

    if (input.state && input.state !== deployment.state) {
      assertDeploymentTransition(deployment.state, input.state);
      const [lastStep] = await transaction
        .select({
          id: deploymentSteps.id,
          sequence: deploymentSteps.sequence,
          status: deploymentSteps.status,
        })
        .from(deploymentSteps)
        .where(eq(deploymentSteps.deploymentId, deploymentId))
        .orderBy(desc(deploymentSteps.sequence))
        .limit(1);
      const now = new Date();
      if (lastStep?.status === "running") {
        await transaction
          .update(deploymentSteps)
          .set({
            finishedAt: now,
            status: completedStepStatus(input.state),
          })
          .where(eq(deploymentSteps.id, lastStep.id));
      }
      const isTerminal = terminalDeploymentStates.has(input.state);
      await transaction.insert(deploymentSteps).values({
        deploymentId,
        finishedAt: isTerminal ? now : null,
        message: sanitizeMessage(input.message),
        sequence: (lastStep?.sequence ?? -1) + 1,
        startedAt: now,
        state: input.state,
        status: newStepStatus(input.state, isTerminal),
      });
      await transaction
        .update(deployments)
        .set({
          errorCode: deploymentErrorCode(input.state, input.errorCode),
          errorMessage: ["failed", "succeeded_with_warnings"].includes(
            input.state,
          )
            ? sanitizeMessage(input.message)
            : null,
          finishedAt: terminalDeploymentStates.has(input.state) ? now : null,
          startedAt: deployment.state === "queued" ? now : undefined,
          state: input.state,
          updatedAt: now,
        })
        .where(eq(deployments.id, deploymentId));
    }

    if (input.log) {
      const [lastLog] = await transaction
        .select({ sequence: max(deploymentLogChunks.sequence) })
        .from(deploymentLogChunks)
        .where(eq(deploymentLogChunks.deploymentId, deploymentId));
      await transaction.insert(deploymentLogChunks).values({
        content: sanitizeLog(input.log.content),
        deploymentId,
        sequence: (lastLog?.sequence ?? -1) + 1,
        stream: input.log.stream,
      });
    }
    return {
      accepted: true,
      previousState: deployment.state,
      stateChanged: Boolean(input.state && input.state !== deployment.state),
    };
  });
  if (input.state) {
    await propagatePreviewDeploymentState(deploymentId, input.state, {
      publish: result.stateChanged,
    });
    if (result.stateChanged) {
      const notificationType = deploymentNotificationType(
        result.previousState,
        input.state,
      );
      if (notificationType) {
        await emitDeploymentNotification(deploymentId, notificationType).catch(
          () => undefined,
        );
      }
    }
  }
  return { accepted: result.accepted };
}

function deploymentNotificationType(
  previous: DeploymentState,
  next: DeploymentState,
) {
  if (previous === "queued" && !terminalDeploymentStates.has(next)) {
    return "deployment.started" as const;
  }
  if (next === "succeeded" || next === "succeeded_with_warnings") {
    return "deployment.succeeded" as const;
  }
  if (next === "failed") return "deployment.failed" as const;
  if (next === "cancelled") return "deployment.cancelled" as const;
  return null;
}

function completedStepStatus(state: DeploymentState) {
  if (state === "failed") return "failed" as const;
  if (state === "cancelled") return "skipped" as const;
  return "succeeded" as const;
}

function newStepStatus(state: DeploymentState, isTerminal: boolean) {
  if (state === "failed" || state === "succeeded_with_warnings") {
    return "failed" as const;
  }
  if (state === "cancelled" || state === "skipped") return "skipped" as const;
  return isTerminal ? ("succeeded" as const) : ("running" as const);
}

function deploymentErrorCode(
  state: DeploymentState,
  supplied: string | undefined,
) {
  if (state !== "failed" && state !== "succeeded_with_warnings") {
    return null;
  }
  return (
    supplied ??
    (state === "failed" ? "DEPLOYMENT_FAILED" : "POST_DEPLOY_HOOK_FAILED")
  );
}

function sanitizeMessage(value: string | undefined) {
  return value ? stripControlCharacters(value, true).slice(0, 1_000) : null;
}

function sanitizeLog(value: string) {
  return stripControlCharacters(value, false).slice(0, 64 * 1_024);
}

function stripControlCharacters(value: string, replaceWhitespace: boolean) {
  let result = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) {
      result += replaceWhitespace ? " " : character;
    } else if (code >= 32 && code !== 127) {
      result += character;
    } else if (replaceWhitespace) {
      result += " ";
    }
  }
  return result;
}
