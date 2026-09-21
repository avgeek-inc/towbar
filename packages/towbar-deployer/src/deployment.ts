import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  deploymentCleanupId,
  deploymentRemoteIdentity,
  deploymentRuntimeId,
} from "./deployment-identity.js";
import {
  cleanupBuildServerArtifacts,
  finishPromotedDeployment,
  preflightBuildServer,
  prepareDeploymentImage,
  startAndVerifyCandidates,
} from "./deployment-phases.js";
import { safeLog, transition } from "./executor-hooks.js";
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
import { inspectImageProvenance } from "./image-provenance.js";
import { executeComposeDeployment } from "./compose-deployment.js";
import type { CloudflareTunnelTransition } from "./cloudflare.js";
import {
  isNormalizedCompose,
  isNormalizedResource,
} from "@workspace/towbar-core";

import type {
  DeploymentExecutionContext,
  DeploymentResult,
  DeploymentSecrets,
  ExecutorHooks,
  SshLoginSecret,
} from "./types.js";

// eslint-disable-next-line complexity -- This is the top-level transaction coordinator for mutually exclusive deployment kinds and rollback paths.
export async function executeDeployment(input: {
  context: DeploymentExecutionContext;
  deferCleanup?: boolean;
  hooks?: ExecutorHooks;
  secrets: DeploymentSecrets;
  signal?: AbortSignal;
}): Promise<DeploymentResult> {
  const { context, deferCleanup = false, hooks = {}, secrets, signal } = input;
  if (isNormalizedCompose(context.app)) {
    const localDirectory = await mkdtemp(
      path.join(tmpdir(), "towbar-compose-"),
    );
    try {
      return await executeComposeDeployment({
        context,
        hooks,
        secrets,
        signal,
        localDirectory,
      });
    } finally {
      await rm(localDirectory, { force: true, recursive: true });
    }
  }
  if (
    deferCleanup &&
    (context.app.container.networkAlias ||
      context.app.container.volumes?.length)
  ) {
    throw new Error(
      "The self-managed Towbar worker cannot use persistent volumes or a stop/start network alias",
    );
  }
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
  let candidateContainerNames = [containerName];
  const warnings: string[] = [];
  let session: SshSession | undefined;
  let buildSession: SshSession | undefined;
  let phaseInput: Parameters<typeof prepareDeploymentImage>[0] | undefined;
  try {
    if (usedAdmissionBuildFallback(context))
      warnings.push(
        "The selected build server was not ready at admission; the build ran on the runtime server as explicitly permitted by the manifest.",
      );
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
    if (context.buildServer) {
      try {
        if (!secrets.buildLogin)
          throw new Error(
            "The selected build server credentials are unavailable",
          );
        buildSession = await SshSession.connect({
          login: secrets.buildLogin,
          server: context.buildServer.config,
          trustedHostKeys: context.buildServer.trustedHostKeys,
        });
        await preflightBuildServer(buildSession, signal);
      } catch (error) {
        if (!allowsRuntimeBuildFallback(context)) throw error;
        await buildSession?.close().catch(() => undefined);
        warnings.push(
          "The selected build server was unavailable; the build ran on the runtime server as explicitly permitted by the manifest.",
        );
        await transition(
          hooks,
          "preparing",
          "Build server unavailable; using the permitted runtime fallback",
        );
        buildSession = undefined;
      }
    }
    phaseInput = {
      containerName,
      context,
      hooks,
      imageTag: selectedImageTag,
      localDirectory,
      remoteDirectory,
      secrets,
      sensitiveValues,
      session,
      buildSession,
      cloudflareTunnelTransition: undefined as
        CloudflareTunnelTransition | undefined,
      signal,
    };
    await prepareDeploymentImage(phaseInput);
    const imageProvenance = await inspectImageProvenance({
      imageTag: selectedImageTag,
      session,
      signal,
    });
    const expectedImagePlatform = declaredApplicationImagePlatform(context);
    if (
      expectedImagePlatform &&
      imageProvenance.imagePlatform !== expectedImagePlatform
    )
      throw new Error(
        `The pulled image uses ${imageProvenance.imagePlatform}, but the manifest requires ${expectedImagePlatform}`,
      );
    const candidates = await startAndVerifyCandidates(phaseInput);
    candidateContainerNames = candidates.containerNames;

    const result = {
      candidatePort: candidates.candidatePorts[0] ?? 0,
      candidatePorts: candidates.candidatePorts,
      containerName: candidates.containerNames[0] ?? containerName,
      containerNames: candidates.containerNames,
      ...imageProvenance,
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
      containerNames: candidateContainerNames,
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
      await phaseInput?.cloudflareTunnelTransition
        ?.rollback()
        .catch(() => undefined);
      for (const candidate of candidateContainerNames.slice(1)) {
        await session
          .run('docker rm -f "$1" >/dev/null 2>&1 || true', [candidate], {
            timeoutMs: 30_000,
          })
          .catch(() => undefined);
      }
      await session
        .run(
          rollbackCandidateScript,
          [
            remoteDirectory,
            cleanupId,
            candidateContainerNames[0] ?? containerName,
            selectedImageTag,
            String(selectedImage.removeOnFailure),
            context.currentRelease?.containerName ?? "",
            deploymentRuntimeId(context),
          ],
          { timeoutMs: 120_000 },
        )
        .catch(async (rollbackError) => {
          await safeLog(
            hooks,
            `Candidate rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}\n`,
            "stderr",
            sensitiveValues,
          );
        });
      for (const previous of (
        context.currentRelease?.containerNames ??
        (context.currentRelease?.containerName
          ? [context.currentRelease.containerName]
          : [])
      ).slice(1)) {
        await session
          .run('docker start "$1" >/dev/null 2>&1 || true', [previous], {
            timeoutMs: 30_000,
          })
          .catch(() => undefined);
      }
    }
    if (failureBoundary === "committed") {
      throw new DeploymentCommittedError(error);
    }
    if (failureBoundary === "commit-uncertain") {
      throw new DeploymentCommitUncertainError(error);
    }
    throw error;
  } finally {
    if (buildSession) {
      if (phaseInput)
        await cleanupBuildServerArtifacts(phaseInput).catch(() => undefined);
      await buildSession
        .run('rm -rf -- "$1"', [remoteDirectory], { timeoutMs: 30_000 })
        .catch(() => undefined);
      await buildSession.close().catch(() => undefined);
    }
    await session?.close().catch(() => undefined);
    await rm(localDirectory, { force: true, recursive: true });
  }
}

function declaredApplicationImagePlatform(context: DeploymentExecutionContext) {
  if (isNormalizedResource(context.app) || isNormalizedCompose(context.app))
    return undefined;
  return context.app.deployment?.type === "image"
    ? context.app.deployment.platform
    : undefined;
}

function allowsRuntimeBuildFallback(context: DeploymentExecutionContext) {
  return (
    !isNormalizedResource(context.app) &&
    !isNormalizedCompose(context.app) &&
    context.app.buildServer?.allowRuntimeFallback === true
  );
}

function usedAdmissionBuildFallback(context: DeploymentExecutionContext) {
  return (
    allowsRuntimeBuildFallback(context) &&
    !context.buildServer &&
    !isNormalizedResource(context.app) &&
    !isNormalizedCompose(context.app) &&
    context.app.buildServer?.ip !== context.server.ip
  );
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
  const candidateContainerNames = deploymentContainerNames(
    input.context,
    containerName,
  );
  const session = await SshSession.connect({
    login: input.login,
    server: input.context.server,
    trustedHostKeys: input.context.trustedHostKeys,
  });
  try {
    for (const candidate of candidateContainerNames.slice(1)) {
      await session.run(
        'docker rm -f "$1" >/dev/null 2>&1 || true',
        [candidate],
        {
          timeoutMs: 30_000,
        },
      );
    }
    await session.run(
      rollbackCandidateScript,
      [
        remoteDirectory,
        cleanupId,
        candidateContainerNames[0] ?? containerName,
        selectedImage.imageTag,
        String(selectedImage.removeOnFailure),
        input.context.currentRelease?.containerName ?? "",
        deploymentRuntimeId(input.context),
      ],
      { timeoutMs: 120_000 },
    );
    for (const previous of (
      input.context.currentRelease?.containerNames ??
      (input.context.currentRelease?.containerName
        ? [input.context.currentRelease.containerName]
        : [])
    ).slice(1)) {
      await session.run(
        'docker start "$1" >/dev/null 2>&1 || true',
        [previous],
        {
          timeoutMs: 30_000,
        },
      );
    }
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
  const containerNames = deploymentContainerNames(input.context, containerName);
  const session = await SshSession.connect({
    login: input.login,
    server: input.context.server,
    trustedHostKeys: input.context.trustedHostKeys,
  });
  try {
    await session.run(
      finalizeRemoteScript,
      [
        remoteDirectory,
        cleanupId,
        JSON.stringify(containerNames),
        ...input.retainedImageTags,
      ],
      { timeoutMs: 120_000 },
    );
  } finally {
    await session.close().catch(() => undefined);
  }
}

function deploymentContainerNames(
  context: DeploymentExecutionContext,
  containerName: string,
) {
  if (!isNormalizedCompose(context.app) && context.app.kind === "app") {
    const rollout = context.app.rollout;
    if (rollout?.type === "rolling") {
      return Array.from(
        { length: rollout.replicas },
        (_, index) => `${containerName}-r${index + 1}`,
      );
    }
  }
  return [containerName];
}
