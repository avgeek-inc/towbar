import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  max,
  notInArray,
} from "drizzle-orm";
import {
  assertDeploymentTransition,
  deploymentStateSchema,
  terminalDeploymentStates,
} from "@workspace/towbar-core/temporal";
import { digestValue } from "@workspace/towbar-core";
import {
  deployableRuntimeStates,
  deploymentLogChunks,
  deploymentSteps,
  deployments,
  githubInstallations,
  releases,
  sources,
  sshHostKeys,
} from "@workspace/towbar-database/schema";

import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { cancelDeploymentWorkflow } from "../../infrastructure/temporal.js";
import { publicDeploymentSelection } from "../deployment-selection.js";
import { resolveAwsSecret } from "../aws/service.js";
import { createInstallationToken } from "../github/client.js";
import { sshLoginSecretSchema } from "../servers/service.js";
import { collectRetainedImageTags } from "./image-retention.js";

import type { DeploymentState } from "@workspace/towbar-core/temporal";

export {
  mergeEnvironmentSecretBundles,
  resolveDeploymentSecrets,
} from "./deployment-secrets.js";
const publicDeploymentStepSelection = {
  createdAt: deploymentSteps.createdAt,
  finishedAt: deploymentSteps.finishedAt,
  id: deploymentSteps.id,
  message: deploymentSteps.message,
  sequence: deploymentSteps.sequence,
  startedAt: deploymentSteps.startedAt,
  state: deploymentSteps.state,
  status: deploymentSteps.status,
};
const publicDeploymentLogSelection = {
  content: deploymentLogChunks.content,
  createdAt: deploymentLogChunks.createdAt,
  id: deploymentLogChunks.id,
  sequence: deploymentLogChunks.sequence,
  stream: deploymentLogChunks.stream,
};

export async function listDeployments(workspaceId: string, sourceId?: string) {
  return await getTowbarDatabase()
    .select(publicDeploymentSelection)
    .from(deployments)
    .where(
      sourceId
        ? and(
            eq(deployments.workspaceId, workspaceId),
            eq(deployments.sourceId, sourceId),
          )
        : eq(deployments.workspaceId, workspaceId),
    )
    .orderBy(desc(deployments.createdAt));
}

export async function getDeployment(deploymentId: string, workspaceId: string) {
  const [deployment] = await getTowbarDatabase()
    .select(publicDeploymentSelection)
    .from(deployments)
    .where(
      and(
        eq(deployments.id, deploymentId),
        eq(deployments.workspaceId, workspaceId),
      ),
    )
    .limit(1);
  if (!deployment) throw notFound("Deployment");
  return deployment;
}

export async function listDeploymentSteps(
  deploymentId: string,
  workspaceId: string,
) {
  await getDeployment(deploymentId, workspaceId);
  return await getTowbarDatabase()
    .select(publicDeploymentStepSelection)
    .from(deploymentSteps)
    .where(eq(deploymentSteps.deploymentId, deploymentId))
    .orderBy(asc(deploymentSteps.sequence));
}

export async function listDeploymentLogs(input: {
  afterSequence?: number;
  deploymentId: string;
  workspaceId: string;
}) {
  await getDeployment(input.deploymentId, input.workspaceId);
  return await getTowbarDatabase()
    .select(publicDeploymentLogSelection)
    .from(deploymentLogChunks)
    .where(
      input.afterSequence === undefined
        ? eq(deploymentLogChunks.deploymentId, input.deploymentId)
        : and(
            eq(deploymentLogChunks.deploymentId, input.deploymentId),
            gt(deploymentLogChunks.sequence, input.afterSequence),
          ),
    )
    .orderBy(asc(deploymentLogChunks.sequence))
    .limit(500);
}

export async function cancelDeployment(
  deploymentId: string,
  workspaceId: string,
) {
  const deployment = await getDeployment(deploymentId, workspaceId);
  if (terminalDeploymentStates.has(deployment.state)) {
    throw conflict("This deployment has already finished");
  }
  const cancelledBeforeStart = await cancelQueuedDeployment(
    deploymentId,
    workspaceId,
  );
  if (cancelledBeforeStart) return cancelledBeforeStart;
  await cancelDeploymentWorkflow(deploymentId);
  return deployment;
}

async function cancelQueuedDeployment(
  deploymentId: string,
  workspaceId: string,
) {
  return await getTowbarDatabase().transaction(async (transaction) => {
    const now = new Date();
    const [deployment] = await transaction
      .update(deployments)
      .set({ finishedAt: now, state: "cancelled", updatedAt: now })
      .where(
        and(
          eq(deployments.id, deploymentId),
          eq(deployments.workspaceId, workspaceId),
          eq(deployments.state, "queued"),
        ),
      )
      .returning(publicDeploymentSelection);
    if (!deployment) return null;
    await transaction.insert(deploymentSteps).values({
      deploymentId,
      finishedAt: now,
      message: "Deployment cancelled before execution",
      sequence: 0,
      startedAt: now,
      state: "cancelled",
      status: "skipped",
    });
    return deployment;
  });
}

export async function getDeploymentExecutionContext(deploymentId: string) {
  const [context] = await getTowbarDatabase()
    .select({
      app: deployments.appSnapshot,
      appId: deployments.appId,
      commitSha: deployments.commitSha,
      deploymentId: deployments.id,
      installationId: githubInstallations.installationId,
      kind: deployments.kind,
      repositoryName: sources.repositoryName,
      repositoryOwner: sources.repositoryOwner,
      rollbackRelease: deployments.rollbackReleaseSnapshot,
      server: deployments.serverSnapshot,
      serverId: deployments.serverId,
      sourceId: deployments.sourceId,
      workspaceId: deployments.workspaceId,
    })
    .from(deployments)
    .innerJoin(sources, eq(sources.id, deployments.sourceId))
    .innerJoin(
      githubInstallations,
      eq(githubInstallations.id, sources.githubInstallationId),
    )
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!context) throw notFound("Deployment");
  if (context.kind === "rollback" && !context.rollbackRelease) {
    throw new Error("Rollback deployment is missing its release snapshot");
  }
  const trustedHostKeys = await getTowbarDatabase()
    .select({
      algorithm: sshHostKeys.algorithm,
      fingerprint: sshHostKeys.fingerprint,
      publicKey: sshHostKeys.publicKey,
    })
    .from(sshHostKeys)
    .where(
      and(
        eq(sshHostKeys.serverId, context.serverId),
        isNull(sshHostKeys.revokedAt),
      ),
    );
  const [currentRelease] = await getTowbarDatabase()
    .select({
      containerName: releases.containerName,
      imageTag: releases.imageTag,
    })
    .from(releases)
    .where(
      and(eq(releases.appId, context.appId), eq(releases.status, "current")),
    )
    .limit(1);
  const { appId, ...publicContext } = context;
  return {
    ...publicContext,
    currentRelease: currentRelease ?? null,
    deployableId: appId,
    githubToken:
      context.kind === "deploy"
        ? await createInstallationToken(context.installationId)
        : null,
    trustedHostKeys,
  };
}

export async function resolveDeploymentLogin(deploymentId: string) {
  const [deployment] = await getTowbarDatabase()
    .select({
      server: deployments.serverSnapshot,
      sourceId: deployments.sourceId,
      workspaceId: deployments.workspaceId,
    })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!deployment) throw notFound("Deployment");
  return sshLoginSecretSchema.parse(
    await resolveAwsSecret({
      secretReference: deployment.server.secrets.login,
      sourceId: deployment.sourceId,
      workspaceId: deployment.workspaceId,
    }),
  );
}

export async function getDeploymentRecoveryStatus(deploymentId: string) {
  const [deployment] = await getTowbarDatabase()
    .select({ appId: deployments.appId, state: deployments.state })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);
  if (!deployment) throw notFound("Deployment");
  const [release] = await getTowbarDatabase()
    .select({ id: releases.id })
    .from(releases)
    .where(eq(releases.deploymentId, deploymentId))
    .limit(1);
  if (!release) {
    return { committed: false, retainedImageTags: [], state: deployment.state };
  }
  const retainedReleases = await getTowbarDatabase()
    .select({ imageTag: releases.imageTag })
    .from(releases)
    .where(
      and(
        eq(releases.appId, deployment.appId),
        inArray(releases.status, ["current", "previous"]),
      ),
    );
  const rollbackReservations = await getTowbarDatabase()
    .select({
      rollbackReleaseSnapshot: deployments.rollbackReleaseSnapshot,
    })
    .from(deployments)
    .where(
      and(
        eq(deployments.appId, deployment.appId),
        eq(deployments.kind, "rollback"),
        notInArray(deployments.state, [
          "cancelled",
          "failed",
          "succeeded",
          "succeeded_with_warnings",
          "skipped",
        ]),
      ),
    );
  return {
    committed: true,
    retainedImageTags: collectRetainedImageTags(
      retainedReleases,
      rollbackReservations,
    ),
    state: deployment.state,
  };
}

export async function recordDeploymentEvent(
  deploymentId: string,
  input: {
    errorCode?: string;
    log?: { content: string; stream: "stderr" | "stdout" };
    message?: string;
    state?: DeploymentState;
  },
) {
  return await getTowbarDatabase().transaction(async (transaction) => {
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
            status:
              input.state === "failed"
                ? "failed"
                : input.state === "cancelled"
                  ? "skipped"
                  : "succeeded",
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
        status:
          input.state === "failed" || input.state === "succeeded_with_warnings"
            ? "failed"
            : input.state === "cancelled" || input.state === "skipped"
              ? "skipped"
              : isTerminal
                ? "succeeded"
                : "running",
      });
      await transaction
        .update(deployments)
        .set({
          errorCode: ["failed", "succeeded_with_warnings"].includes(input.state)
            ? (input.errorCode ??
              (input.state === "failed"
                ? "DEPLOYMENT_FAILED"
                : "POST_DEPLOY_HOOK_FAILED"))
            : null,
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
    return { accepted: true };
  });
}

export async function commitDeploymentRelease(
  deploymentId: string,
  input: { containerName: string; imageTag: string },
) {
  const result = await getTowbarDatabase().transaction(async (transaction) => {
    const [deployment] = await transaction
      .select({
        appId: deployments.appId,
        appSnapshot: deployments.appSnapshot,
        commitSha: deployments.commitSha,
        deploymentDigest: deployments.deploymentDigest,
        sourceInputDigest: deployments.sourceInputDigest,
      })
      .from(deployments)
      .where(eq(deployments.id, deploymentId))
      .for("update")
      .limit(1);
    if (!deployment) throw notFound("Deployment");
    const [existingRelease] = await transaction
      .select()
      .from(releases)
      .where(eq(releases.deploymentId, deploymentId))
      .limit(1);
    let release = existingRelease;
    // Activities are at-least-once. A replay after the first commit must not
    // demote the release that this same deployment already promoted.
    if (!release) {
      await transaction
        .update(releases)
        .set({ status: "superseded", supersededAt: new Date() })
        .where(
          and(
            eq(releases.appId, deployment.appId),
            eq(releases.status, "previous"),
          ),
        );
      await transaction
        .update(releases)
        .set({ status: "previous" })
        .where(
          and(
            eq(releases.appId, deployment.appId),
            eq(releases.status, "current"),
          ),
        );
      [release] = await transaction
        .insert(releases)
        .values({
          appId: deployment.appId,
          commitSha: deployment.commitSha,
          configDigest: digestValue(deployment.appSnapshot),
          deploymentDigest: deployment.deploymentDigest,
          containerName: input.containerName,
          deploymentId,
          imageTag: input.imageTag,
          sourceInputDigest: deployment.sourceInputDigest,
          status: "current",
        })
        .onConflictDoUpdate({
          target: releases.deploymentId,
          set: {
            containerName: input.containerName,
            imageTag: input.imageTag,
            status: "current",
            supersededAt: null,
          },
        })
        .returning();
    }
    if (!release) throw new Error("Unable to commit deployment release");
    await transaction
      .insert(deployableRuntimeStates)
      .values({ appId: deployment.appId, desiredState: "running" })
      .onConflictDoUpdate({
        target: deployableRuntimeStates.appId,
        set: { desiredState: "running", updatedAt: new Date() },
      });

    const retainedReleases = await transaction
      .select({ imageTag: releases.imageTag })
      .from(releases)
      .where(
        and(
          eq(releases.appId, deployment.appId),
          inArray(releases.status, ["current", "previous"]),
        ),
      );
    const rollbackReservations = await transaction
      .select({
        rollbackReleaseSnapshot: deployments.rollbackReleaseSnapshot,
      })
      .from(deployments)
      .where(
        and(
          eq(deployments.appId, deployment.appId),
          eq(deployments.kind, "rollback"),
          notInArray(deployments.state, [
            "cancelled",
            "failed",
            "succeeded",
            "succeeded_with_warnings",
            "skipped",
          ]),
        ),
      );
    return {
      release,
      retainedImageTags: collectRetainedImageTags(
        retainedReleases,
        rollbackReservations,
      ),
    };
  });
  return {
    release: result.release,
    retainedImageTags: result.retainedImageTags,
  };
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

export { deploymentStateSchema };
