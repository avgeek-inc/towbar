import { createHash } from "node:crypto";

import { normalizeDomain } from "./manifest-values.js";

import type { NormalizedApp } from "./manifest.js";

export const deploymentEnvironments = ["production", "preview"] as const;
export type DeploymentEnvironment = (typeof deploymentEnvironments)[number];

export function previewRef(pullRequestNumber: number) {
  return `refs/pull/${pullRequestNumber}/head`;
}

export function previewRefHash(input: {
  pullRequestNumber: number;
  sourceId: string;
}) {
  return createHash("sha256")
    .update(`${input.sourceId}:${previewRef(input.pullRequestNumber)}`)
    .digest("hex")
    .slice(0, 12);
}

export function previewHostname(input: {
  appId: string;
  domain: string;
  pullRequestNumber: number;
  sourceId: string;
}) {
  const hash = previewRefHash(input).slice(0, 8);
  const appSlug = trimTrailingDashes(input.appId.slice(0, 32));
  const suffix = `pr-${input.pullRequestNumber}-${hash}`;
  const maximumSlugLength = Math.max(1, 63 - suffix.length - 1);
  const slug = trimTrailingDashes(appSlug.slice(0, maximumSlugLength));
  return normalizeDomain(`${slug}-${suffix}.${input.domain}`);
}

export function previewRuntimeId(input: {
  appId: string;
  pullRequestNumber: number;
  sourceId: string;
}) {
  return `${input.appId}-preview-${previewRefHash(input)}`;
}

export function createPreviewAppSnapshot(
  app: NormalizedApp,
  input: { branch: string; hostname: string },
): NormalizedApp {
  if (!app.preview?.enabled) {
    throw new Error(`App '${app.id}' does not enable Preview deployments`);
  }
  return {
    ...app,
    domains: { primary: input.hostname, redirects: [] },
    hooks: app.hooks,
    preview: undefined,
    sourceBranch: input.branch,
  };
}

function trimTrailingDashes(value: string) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 45) end -= 1;
  return value.slice(0, end);
}
