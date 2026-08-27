import { createHash } from "node:crypto";

import { normalizeDomain } from "./manifest-values.js";

import type { NormalizedApp, NormalizedDeploymentHook } from "./manifest.js";

export const deploymentEnvironments = ["production", "preview"] as const;
export type DeploymentEnvironment = (typeof deploymentEnvironments)[number];

export function previewRef(branch: string) {
  return `refs/heads/${branch}`;
}

export function previewRefHash(branch: string) {
  return createHash("sha256")
    .update(previewRef(branch))
    .digest("hex")
    .slice(0, 12);
}

export function previewHostname(input: {
  appId: string;
  branch: string;
  domain: string;
}) {
  const hash = previewRefHash(input.branch).slice(0, 8);
  const appSlug = trimTrailingDashes(input.appId.slice(0, 32));
  const maximumSlugLength = Math.max(1, 63 - appSlug.length - hash.length - 2);
  const normalizedBranch = input.branch
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-");
  const slug =
    trimTrailingDashes(
      trimDashes(normalizedBranch).slice(0, maximumSlugLength),
    ) || "branch";
  return normalizeDomain(`${appSlug}-${slug}-${hash}.${input.domain}`);
}

export function previewRuntimeId(appId: string, branch: string) {
  return `${appId}-preview-${previewRefHash(branch)}`;
}

export function createPreviewAppSnapshot(
  app: NormalizedApp,
  input: { branch: string; hostname: string },
): NormalizedApp {
  if (!app.preview?.enabled) {
    throw new Error(`App '${app.id}' does not enable Preview deployments`);
  }
  const preview = app.preview;
  const hooks = {
    ...previewHook(app.hooks.postDeploy, preview.secrets.hooks.postDeploy),
    ...previewHook(app.hooks.preDeploy, preview.secrets.hooks.preDeploy, true),
  };
  return {
    ...app,
    domains: { primary: input.hostname, redirects: [] },
    hooks,
    preview: undefined,
    secrets: {
      ...(preview.secrets.build ? { build: preview.secrets.build } : {}),
      ...(preview.secrets.deployment
        ? { deployment: preview.secrets.deployment }
        : {}),
    },
    sharedSecrets: { build: [], deployment: [] },
    sourceBranch: input.branch,
  };
}

function previewHook(
  hook: NormalizedDeploymentHook | undefined,
  secret: string | undefined,
  preDeploy = false,
) {
  if (!hook) return {};
  const value = {
    command: [...hook.command],
    ...(secret ? { secrets: secret } : {}),
    timeoutSeconds: hook.timeoutSeconds,
  };
  return preDeploy ? { preDeploy: value } : { postDeploy: value };
}

function trimDashes(value: string) {
  let start = 0;
  while (value.charCodeAt(start) === 45) start += 1;
  return trimTrailingDashes(value.slice(start));
}

function trimTrailingDashes(value: string) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 45) end -= 1;
  return value.slice(0, end);
}
