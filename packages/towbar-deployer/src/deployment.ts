import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deploymentCleanupId,
  deploymentRemoteIdentity,
} from "./deployment-identity.js";
import {
  finishPromotedDeployment,
  prepareDeploymentImage,
  startAndVerifyCandidate,
} from "./deployment-phases.js";
import { transition } from "./executor-hooks.js";
import {
  DeploymentCommitUncertainError,
  DeploymentCommittedError,
  resolveDeploymentFailureBoundary,
} from "./promotion-boundary.js";
import {
  finalizeRemoteScript,
  rollbackCandidateScript,
} from "./remote-scripts.js";
import { selectDeploymentImage } from "./release-selection.js";
import { collectSensitiveValues } from "./secrets.js";
import { SshSession } from "./ssh.js";

import type {
  DeploymentExecutionContext,
  DeploymentResult,
  DeploymentSecrets,
  ExecutorHooks,
  SshLoginSecret,
} from "./types.js";

export async function executeDeployment(input: {
  context: DeploymentExecutionContext;
  deferCleanup?: boolean;
  hooks?: ExecutorHooks;
  secrets: DeploymentSecrets;
  signal?: AbortSignal;
}): Promise<DeploymentResult> {
  const { context, deferCleanup = false, hooks = {}, secrets, signal } = input;
  const sensitiveValues = collectSensitiveValues(secrets);
  const localDirectory = await mkdtemp(path.join(tmpdir(), "towbar-deploy-"));
  const { containerName, imageTag, remoteDirectory } =
    deploymentRemoteIdentity(context);
  const cleanupId = deploymentCleanupId(context);
  const selectedImage = selectDeploymentImage(context, imageTag);
  const selectedImageTag = selectedImage.imageTag;
  let committed = false;
  let commitAttempted = false;
  let retainedImageTags: string[] | undefined;
  const warnings: string[] = [];
  let session: SshSession | undefined;
  try {
    await transition(
      hooks,
      "preparing",
      "Preparing isolated deployment workspace",
    );
    await transition(
      hooks,
      "validating_credentials",
      "Credentials resolved and validated",
    );
    session = await SshSession.connect({
      login: secrets.login,
      server: context.server,
      trustedHostKeys: context.trustedHostKeys,
    });
    const phaseInput = {
      containerName,
      context,
      hooks,
      imageTag: selectedImageTag,
      localDirectory,
      remoteDirectory,
      secrets,
      sensitiveValues,
      session,
      signal,
    };
    await prepareDeploymentImage(phaseInput);
    const candidatePort = await startAndVerifyCandidate(phaseInput);

    const result = {
      candidatePort,
      containerName,
      imageTag: selectedImageTag,
      warnings,
    };
    await transition(
      hooks,
      "switching_traffic",
      "Promoting the healthy candidate",
    );
    if (hooks.commitRelease) {
      // A failed response is ambiguous because the transaction may be durable.
      // Temporal must query PostgreSQL before deciding whether rollback is safe.
      commitAttempted = true;
      retainedImageTags = (await hooks.commitRelease(result)).retainedImageTags;
    }
    committed = true;
    await finishPromotedDeployment({
      ...phaseInput,
      deferCleanup,
      retainedImageTags: retainedImageTags ?? [],
      warnings,
    });
    return result;
  } catch (error) {
    const failureBoundary = resolveDeploymentFailureBoundary({
      commitAttempted,
      commitConfirmed: committed,
    });
    if (session && failureBoundary === "rollback") {
      await session
        .run(
          rollbackCandidateScript,
          [
            remoteDirectory,
            cleanupId,
            containerName,
            selectedImageTag,
            String(selectedImage.removeOnFailure),
            context.currentRelease?.containerName ?? "",
            context.app.id,
          ],
          { timeoutMs: 120_000 },
        )
        .catch(() => undefined);
    }
    if (failureBoundary === "committed") {
      throw new DeploymentCommittedError(error);
    }
    if (failureBoundary === "commit-uncertain") {
      throw new DeploymentCommitUncertainError(error);
    }
    throw error;
  } finally {
    await session?.close().catch(() => undefined);
    await rm(localDirectory, { force: true, recursive: true });
  }
}

export async function rollbackInterruptedDeployment(input: {
  context: DeploymentExecutionContext;
  login: SshLoginSecret;
}) {
  const { containerName, imageTag, remoteDirectory } = deploymentRemoteIdentity(
    input.context,
  );
  const cleanupId = deploymentCleanupId(input.context);
  const selectedImage = selectDeploymentImage(input.context, imageTag);
  const session = await SshSession.connect({
    login: input.login,
    server: input.context.server,
    trustedHostKeys: input.context.trustedHostKeys,
  });
  try {
    await session.run(
      rollbackCandidateScript,
      [
        remoteDirectory,
        cleanupId,
        containerName,
        selectedImage.imageTag,
        String(selectedImage.removeOnFailure),
        input.context.currentRelease?.containerName ?? "",
        input.context.app.id,
      ],
      { timeoutMs: 120_000 },
    );
  } finally {
    await session.close().catch(() => undefined);
  }
}

export async function finalizeInterruptedDeployment(input: {
  context: DeploymentExecutionContext;
  login: SshLoginSecret;
  retainedImageTags: string[];
}) {
  const { containerName, remoteDirectory } = deploymentRemoteIdentity(
    input.context,
  );
  const cleanupId = deploymentCleanupId(input.context);
  const session = await SshSession.connect({
    login: input.login,
    server: input.context.server,
    trustedHostKeys: input.context.trustedHostKeys,
  });
  try {
    await session.run(
      finalizeRemoteScript,
      [remoteDirectory, cleanupId, containerName, ...input.retainedImageTags],
      { timeoutMs: 120_000 },
    );
  } finally {
    await session.close().catch(() => undefined);
  }
}
