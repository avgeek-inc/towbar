import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createBuildContextArchive } from "./build-context.js";
import { parseCandidatePort } from "./candidate-port.js";
import { deploymentCleanupId } from "./deployment-identity.js";
import { reconcileCloudflareForDeployment } from "./cloudflare.js";
import { checkOriginEndpoint, checkPublicEndpoint } from "./endpoint-health.js";
import { runWithSafeLogs, safeLog, transition } from "./executor-hooks.js";
import {
  buildRemoteScript,
  configureCaddyScript,
  containerHealthRemoteScript,
  finalizeRemoteScript,
  healthRemoteScript,
  hookRemoteScript,
  prepareRemoteScript,
  scheduleFinalizeRemoteScript,
  startRemoteScript,
  startResourceRemoteScript,
} from "./remote-scripts.js";
import { renderCaddyFragment } from "./routing.js";
import { pullResourceImage } from "./pull-resource-image.js";
import {
  MAX_SOURCE_ARCHIVE_ENTRIES,
  MAX_SOURCE_EXPANDED_BYTES,
  fetchDeploymentSource,
} from "./source-fetch.js";
import {
  aggregateBuildSecretKey,
  validateDeploymentSecrets,
} from "./secrets.js";
import { type SshSession, sshConnectionHost } from "./ssh.js";
import type {
  DeploymentExecutionContext,
  DeploymentSecrets,
  ExecutorHooks,
} from "./types.js";
import { isNormalizedResource } from "@workspace/towbar-core";
import type {
  NormalizedApp,
  NormalizedDeploymentHook,
} from "@workspace/towbar-core";

type DeploymentPhaseInput = {
  containerName: string;
  context: DeploymentExecutionContext;
  hooks: ExecutorHooks;
  imageTag: string;
  localDirectory: string;
  remoteDirectory: string;
  secrets: DeploymentSecrets;
  sensitiveValues: string[];
  session: SshSession;
  signal?: AbortSignal;
};

export async function prepareDeploymentImage(input: DeploymentPhaseInput) {
  await transition(
    input.hooks,
    "checking_server",
    "SSH trust and target access verified",
  );
  await preflight(
    input.session,
    input.context.app.tls?.mode === "cloudflare-dns",
    input.signal,
  );
  if (input.context.app.container.network) {
    await input.session.run(
      'docker network inspect "$1" >/dev/null',
      [input.context.app.container.network],
      { signal: input.signal, timeoutMs: 30_000 },
    );
  }

  const checkout = await selectDeploymentSource(input);
  await transition(
    input.hooks,
    "resolving_secrets",
    "Build, runtime, and hook secret bundles validated",
  );
  validateDeploymentSecrets(input.secrets);
  await input.session.run(prepareRemoteScript, [input.remoteDirectory], {
    signal: input.signal,
  });
  await writeSecretFiles(input.localDirectory, input.secrets);
  if (isNormalizedResource(input.context.app)) {
    await uploadSecrets(input);
    if (input.context.kind === "deploy") {
      await pullResourceImage(input);
    } else {
      await verifyRetainedImage(input, false);
    }
  } else if (checkout) {
    await buildDeploymentImage(input, checkout);
  } else {
    await verifyRetainedImage(input, true);
  }

  const application = isNormalizedResource(input.context.app)
    ? null
    : (input.context.app as NormalizedApp);
  const hook =
    input.context.kind === "deploy" ? application?.hooks?.preDeploy : undefined;
  await transition(
    input.hooks,
    "running_pre_deploy",
    hook
      ? "Running pre-deploy hook"
      : "No pre-deploy hook declared; step skipped",
  );
  if (hook) {
    await runDeploymentHook({ ...input, hook, hookName: "preDeploy" });
  }
}

export async function startAndVerifyCandidate(input: DeploymentPhaseInput) {
  await transition(
    input.hooks,
    "starting_candidate",
    "Starting candidate container",
  );
  const resource = isNormalizedResource(input.context.app)
    ? input.context.app
    : null;
  const startResult = resource
    ? await input.session.run(
        `export TOWBAR_APP_ID="$1" TOWBAR_CLEANUP_ID="$2" TOWBAR_DEPLOYMENT_ID="$3" TOWBAR_COMMIT_SHA="$4" TOWBAR_SOURCE_ID="$5" TOWBAR_DEPLOYABLE_ID="$6"\nshift 6\n${startResourceRemoteScript}`,
        [
          resource.id,
          deploymentCleanupId(input.context),
          input.context.deploymentId,
          input.context.commitSha,
          input.context.sourceId,
          input.context.deployableId,
          input.remoteDirectory,
          input.containerName,
          input.imageTag,
          resource.container.port ? String(resource.container.port) : "",
          resource.container.network ?? "",
          resource.container.networkAlias ?? "",
          resource.access?.sshTunnel.hostPort
            ? String(resource.access.sshTunnel.hostPort)
            : "",
          String(resource.container.resources.cpus),
          resource.container.resources.memory,
          input.context.currentRelease?.containerName ?? "",
          input.context.deployableId,
          String(resource.container.volumes.length),
          ...resource.container.volumes.flatMap((volume) => [
            volume.name,
            volume.mountPath,
          ]),
          ...resource.container.command,
        ],
        { signal: input.signal, timeoutMs: 180_000 },
      )
    : await input.session.run(
        `export TOWBAR_APP_ID="$1" TOWBAR_DEPLOYMENT_ID="$2" TOWBAR_COMMIT_SHA="$3" TOWBAR_SOURCE_ID="$4" TOWBAR_DEPLOYABLE_ID="$5"\nshift 5\n${startRemoteScript}`,
        [
          input.context.app.id,
          input.context.deploymentId,
          input.context.commitSha,
          input.context.sourceId,
          input.context.deployableId,
          input.remoteDirectory,
          input.containerName,
          input.imageTag,
          String(input.context.app.container.port),
          input.context.app.container.network ?? "",
          input.context.app.container.resources
            ? String(input.context.app.container.resources.cpus)
            : "",
          input.context.app.container.resources?.memory ?? "",
        ],
        { signal: input.signal, timeoutMs: 120_000 },
      );
  const requiresPublishedPort = !resource || Boolean(resource.container.port);
  const candidatePort = parseCandidatePort(
    startResult.stdout,
    requiresPublishedPort,
  );

  await transition(input.hooks, "checking_health", "Checking candidate health");
  if (resource && resource.health.type !== "http") {
    await input.session.run(
      containerHealthRemoteScript,
      [
        input.containerName,
        resource.health.type,
        String(resource.health.timeoutSeconds),
        ...(resource.health.type === "command" ? resource.health.command : []),
      ],
      {
        signal: input.signal,
        timeoutMs: (resource.health.timeoutSeconds + 10) * 1_000,
      },
    );
  } else {
    const health = resource?.health ?? input.context.app.health;
    if (!("path" in health)) throw new Error("HTTP health path is missing");
    await input.session.run(
      healthRemoteScript,
      [String(candidatePort), health.path, String(health.timeoutSeconds)],
      {
        signal: input.signal,
        timeoutMs: (health.timeoutSeconds + 10) * 1_000,
      },
    );
  }
  await configureAndVerifyRouting(input, candidatePort);
  return candidatePort;
}

export async function finishPromotedDeployment(
  input: DeploymentPhaseInput & {
    deferCleanup: boolean;
    retainedImageTags: string[];
    warnings: string[];
  },
) {
  const application = isNormalizedResource(input.context.app)
    ? null
    : (input.context.app as NormalizedApp);
  const hook =
    input.context.kind === "deploy"
      ? application?.hooks?.postDeploy
      : undefined;
  await transition(
    input.hooks,
    "running_post_deploy",
    hook
      ? "Running post-deploy hook"
      : "No post-deploy hook declared; step skipped",
  );
  if (hook) {
    await runDeploymentHook({ ...input, hook, hookName: "postDeploy" }).catch(
      async () => {
        const warning =
          "Post-deploy hook failed after promotion; the release remains live";
        input.warnings.push(warning);
        await safeLog(
          input.hooks,
          `${warning}.\n`,
          "stderr",
          input.sensitiveValues,
        );
      },
    );
  }

  await transition(
    input.hooks,
    "cleaning_up",
    input.deferCleanup
      ? "Scheduling cleanup after the self-managed worker handoff"
      : "Retaining current and previous releases",
  );
  await input.session
    .run(
      input.deferCleanup ? scheduleFinalizeRemoteScript : finalizeRemoteScript,
      [
        input.remoteDirectory,
        deploymentCleanupId(input.context),
        input.containerName,
        ...(input.deferCleanup ? ["20"] : []),
        ...input.retainedImageTags,
      ],
      { signal: input.signal, timeoutMs: 120_000 },
    )
    .catch(async () => {
      await safeLog(
        input.hooks,
        "Post-promotion cleanup was deferred until a later deployment.\n",
        "stderr",
        input.sensitiveValues,
      );
    });
  await transition(
    input.hooks,
    input.warnings.length > 0 ? "succeeded_with_warnings" : "succeeded",
    input.warnings.length > 0
      ? "Deployment completed with post-deploy warnings"
      : input.deferCleanup
        ? "Deployment completed; previous worker cleanup was handed off"
        : "Deployment completed",
  );
}

async function selectDeploymentSource(input: DeploymentPhaseInput) {
  if (input.context.kind === "rollback") {
    await transition(
      input.hooks,
      "fetching_source",
      `Selecting retained release ${input.context.rollbackRelease?.releaseId.slice(0, 8)}`,
    );
    return undefined;
  }
  if (isNormalizedResource(input.context.app)) {
    await transition(
      input.hooks,
      "fetching_source",
      `Selecting image ${input.context.app.image}`,
    );
    return undefined;
  }
  await transition(
    input.hooks,
    "fetching_source",
    `Fetching commit ${input.context.commitSha.slice(0, 12)}`,
  );
  return await fetchDeploymentSource(
    input.context,
    input.localDirectory,
    input.signal,
  );
}

async function buildDeploymentImage(
  input: DeploymentPhaseInput,
  checkout: string,
) {
  const application = input.context.app as NormalizedApp;
  const contextArchive = path.join(input.localDirectory, "context.tar.gz");
  const { relativeDockerfile } = await createBuildContextArchive({
    archivePath: contextArchive,
    checkout,
    contextPath: application.context,
    dockerfilePath: application.dockerfile,
    signal: input.signal,
  });
  await transition(
    input.hooks,
    "transferring",
    "Transferring minimal build context",
  );
  await input.session.upload(
    contextArchive,
    `${input.remoteDirectory}/context.tar.gz`,
    { signal: input.signal },
  );
  await uploadSecrets(input);
  await transition(input.hooks, "building", "Building immutable Docker image");
  await runWithSafeLogs({
    hooks: input.hooks,
    run: async (outputHandlers) =>
      await input.session.run(
        `export TOWBAR_APP_ID="$1" TOWBAR_COMMIT_SHA="$2" TOWBAR_SOURCE_ID="$3" TOWBAR_DEPLOYABLE_ID="$4"\nshift 4\n${buildRemoteScript}`,
        [
          input.context.app.id,
          input.context.commitSha,
          input.context.sourceId,
          input.context.deployableId,
          input.remoteDirectory,
          input.imageTag,
          relativeDockerfile,
          String(MAX_SOURCE_EXPANDED_BYTES),
          String(MAX_SOURCE_ARCHIVE_ENTRIES),
        ],
        {
          ...outputHandlers,
          signal: input.signal,
          timeoutMs: 45 * 60_000,
        },
      ),
    sensitiveValues: input.sensitiveValues,
  });
}

async function verifyRetainedImage(
  input: DeploymentPhaseInput,
  uploadRuntimeSecrets: boolean,
) {
  await transition(
    input.hooks,
    "transferring",
    "Transferring runtime configuration for retained release",
  );
  if (uploadRuntimeSecrets) await uploadSecrets(input);
  await transition(input.hooks, "building", "Verifying retained Docker image");
  await input.session.run(
    'docker image inspect "$1" >/dev/null',
    [input.imageTag],
    {
      signal: input.signal,
      timeoutMs: 30_000,
    },
  );
}

async function configureAndVerifyRouting(
  input: DeploymentPhaseInput,
  candidatePort: number,
) {
  await transition(
    input.hooks,
    "configuring_routing",
    "Reconciling DNS and validating generated Caddy routing",
  );
  await reconcileCloudflareForDeployment({
    app: input.context.app,
    credentials: input.secrets.cloudflare,
    server: input.context.server,
  });
  await writeRoutingFiles(input, candidatePort);
  if (!input.context.app.domains) {
    await transition(
      input.hooks,
      "provisioning_tls",
      "No domain declared; TLS skipped",
    );
    await transition(
      input.hooks,
      "checking_public_endpoint",
      "No public endpoint declared; check skipped",
    );
    return;
  }

  await input.session.upload(
    path.join(input.localDirectory, "app.caddy"),
    `${input.remoteDirectory}/app.caddy`,
    { signal: input.signal },
  );
  if (input.secrets.cloudflare) {
    await input.session.upload(
      path.join(input.localDirectory, "cloudflare.env"),
      `${input.remoteDirectory}/cloudflare.env`,
      { signal: input.signal },
    );
  }
  await transition(
    input.hooks,
    "provisioning_tls",
    "Provisioning TLS through Caddy",
  );
  await input.session.run(
    configureCaddyScript,
    [input.remoteDirectory, input.context.app.id],
    { signal: input.signal, timeoutMs: 180_000 },
  );
  await transition(
    input.hooks,
    "checking_public_endpoint",
    "Checking origin and public HTTPS endpoints",
  );
  await checkOriginEndpoint(
    sshConnectionHost(input.context.server),
    input.context.app.domains.primary,
    getPublicHealthPath(input.context),
    input.signal,
  );
  await checkPublicEndpoint(
    input.context.app.domains.primary,
    getPublicHealthPath(input.context),
    input.signal,
  );
}

function getPublicHealthPath(context: DeploymentExecutionContext) {
  if (isNormalizedResource(context.app)) {
    if (context.app.health.type !== "http") {
      throw new Error("Public resources require an HTTP health check");
    }
    return context.app.health.path;
  }
  return context.app.health.path;
}

async function writeSecretFiles(
  localDirectory: string,
  secrets: DeploymentSecrets,
) {
  const directories = {
    build: path.join(localDirectory, "build-secrets"),
    postDeploy: path.join(localDirectory, "hook-secrets", "postDeploy"),
    preDeploy: path.join(localDirectory, "hook-secrets", "preDeploy"),
    runtime: path.join(localDirectory, "runtime-secrets"),
  };
  await Promise.all(
    Object.values(directories).map((directory) =>
      mkdir(directory, { mode: 0o700, recursive: true }),
    ),
  );
  await writeEntries(directories.build, secrets.build);
  await writeFile(
    path.join(directories.build, aggregateBuildSecretKey),
    JSON.stringify(secrets.build),
    { mode: 0o600 },
  );
  await Promise.all([
    writeEntries(directories.runtime, secrets.runtime),
    writeEntries(directories.postDeploy, secrets.hooks.postDeploy),
    writeEntries(directories.preDeploy, secrets.hooks.preDeploy),
  ]);
}

async function writeEntries(
  directory: string,
  entries: Record<string, string>,
) {
  await Promise.all(
    Object.entries(entries).map(([key, value]) =>
      writeFile(path.join(directory, key), value, { mode: 0o600 }),
    ),
  );
}

async function uploadSecrets(input: DeploymentPhaseInput) {
  const files = [
    ...[...Object.keys(input.secrets.build), aggregateBuildSecretKey].map(
      (key) => ["build-secrets", `build/${key}`, key] as const,
    ),
    ...Object.keys(input.secrets.runtime).map(
      (key) => ["runtime-secrets", `runtime/${key}`, key] as const,
    ),
    ...(["postDeploy", "preDeploy"] as const).flatMap((hookName) =>
      Object.keys(input.secrets.hooks[hookName]).map(
        (key) =>
          [
            `hook-secrets/${hookName}`,
            `hooks/${hookName}/${key}`,
            key,
          ] as const,
      ),
    ),
  ];
  for (const [localParent, remotePath, key] of files) {
    await input.session.upload(
      path.join(input.localDirectory, localParent, key),
      `${input.remoteDirectory}/secrets/${remotePath}`,
      { signal: input.signal },
    );
  }
  await input.session.run(
    'set -euo pipefail\nfind "$1"/secrets -type f -exec chmod 600 {} +\n',
    [input.remoteDirectory],
    { signal: input.signal },
  );
}

async function runDeploymentHook(
  input: DeploymentPhaseInput & {
    hook: NormalizedDeploymentHook;
    hookName: "postDeploy" | "preDeploy";
  },
) {
  await runWithSafeLogs({
    hooks: input.hooks,
    run: async (outputHandlers) =>
      await input.session.run(
        `export TOWBAR_APP_ID="$1" TOWBAR_DEPLOYMENT_ID="$2" TOWBAR_COMMIT_SHA="$3"\nshift 3\n${hookRemoteScript}`,
        [
          input.context.app.id,
          input.context.deploymentId,
          input.context.commitSha,
          input.remoteDirectory,
          input.hookName,
          input.containerName,
          input.imageTag,
          input.context.app.container.network ?? "",
          input.context.app.container.resources
            ? String(input.context.app.container.resources.cpus)
            : "",
          input.context.app.container.resources?.memory ?? "",
          String(input.hook.timeoutSeconds),
          ...input.hook.command,
        ],
        {
          ...outputHandlers,
          signal: input.signal,
          timeoutMs: (input.hook.timeoutSeconds + 30) * 1_000,
        },
      ),
    sensitiveValues: input.sensitiveValues,
  });
}

async function writeRoutingFiles(input: DeploymentPhaseInput, port: number) {
  await writeFile(
    path.join(input.localDirectory, "app.caddy"),
    renderCaddyFragment(input.context, port),
    { mode: 0o600 },
  );
  if (input.secrets.cloudflare) {
    await writeFile(
      path.join(input.localDirectory, "cloudflare.env"),
      `CLOUDFLARE_API_TOKEN=${input.secrets.cloudflare.apiToken}\n`,
      { mode: 0o600 },
    );
  }
  await chmod(input.localDirectory, 0o700);
}

async function preflight(
  session: SshSession,
  requiresCloudflareModule: boolean,
  signal?: AbortSignal,
) {
  await session.run(
    'set -euo pipefail\nrequires_cloudflare="$1"\n. /etc/os-release\ntest "$ID" = ubuntu\ncommand -v docker >/dev/null\ndocker info >/dev/null\ncommand -v caddy >/dev/null\ncommand -v python3 >/dev/null\ncommand -v timeout >/dev/null\nsudo -n /usr/bin/test -d /etc/caddy\nif test "$requires_cloudflare" = true; then caddy list-modules | grep -Fx dns.providers.cloudflare >/dev/null; fi\ntest "$(df -Pk /var/lib/docker | awk \'NR==2 {print $4}\')" -gt 1048576\n',
    [String(requiresCloudflareModule)],
    { signal, timeoutMs: 30_000 },
  );
}
