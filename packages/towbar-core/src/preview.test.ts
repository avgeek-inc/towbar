import assert from "node:assert/strict";
import test from "node:test";

import {
  createPreviewAppSnapshot,
  previewHostname,
  previewRef,
  previewRuntimeId,
} from "./preview.js";

import type { NormalizedApp } from "./manifest.js";

const app: NormalizedApp = {
  autoDeploy: true,
  container: { port: 3000 },
  context: ".",
  deploymentInputs: ["apps/example/**"],
  dockerfile: "apps/example/Dockerfile",
  domains: { primary: "example.com", redirects: [] },
  health: { path: "/health", timeoutSeconds: 60 },
  hooks: {
    postDeploy: {
      command: ["node", "post-deploy.js"],
      secrets: "aws:production/post-deploy",
      timeoutSeconds: 60,
    },
    preDeploy: {
      command: ["node", "migrate.js"],
      secrets: "aws:production/migrate",
      timeoutSeconds: 300,
    },
  },
  id: "example",
  name: "Example",
  preview: {
    domain: "preview.example.com",
    enabled: true,
    secrets: {
      build: "aws:preview/build",
      deployment: "aws:preview/deployment",
      hooks: { preDeploy: "aws:preview/migrate" },
    },
    ttlHours: 72,
  },
  secrets: {
    build: "aws:production/build",
    deployment: "aws:production/deployment",
  },
  server: "203.0.113.10",
  sharedSecrets: {
    build: ["aws:production/shared-build"],
    deployment: ["aws:production/shared-deployment"],
  },
  sourceBranch: "main",
  tls: { mode: "cloudflare-dns" },
};

void test("creates a stable branch hostname and isolated runtime identity", () => {
  const input = {
    appId: app.id,
    branch: "feature/TW-4 preview deploys",
    domain: app.preview!.domain,
  };
  const hostname = previewHostname(input);
  assert.equal(hostname, previewHostname(input));
  assert.match(
    hostname,
    /^example-feature-tw-4-preview-deploys-[a-f0-9]{8}\.preview\.example\.com$/u,
  );
  assert.equal(previewRef(input.branch), `refs/heads/${input.branch}`);
  assert.notEqual(previewRuntimeId(app.id, input.branch), app.id);
  assert.ok(hostname.split(".")[0]!.length <= 63);
});

void test("keeps Preview DNS labels valid for maximum-length app IDs", () => {
  const hostname = previewHostname({
    appId: "a".repeat(63),
    branch: "feature/this-is-a-long-branch-name-that-needs-truncation",
    domain: "preview.example.com",
  });
  assert.ok(hostname.split(".")[0]!.length <= 63);
  assert.match(hostname, /-[a-f0-9]{8}\.preview\.example\.com$/u);
});

void test("builds Preview snapshots without production or shared secrets", () => {
  const snapshot = createPreviewAppSnapshot(app, {
    branch: "feature/tw-4",
    hostname: "example-feature-tw-4.preview.example.com",
  });
  assert.equal(snapshot.preview, undefined);
  assert.equal(snapshot.sourceBranch, "feature/tw-4");
  assert.deepEqual(snapshot.domains, {
    primary: "example-feature-tw-4.preview.example.com",
    redirects: [],
  });
  assert.deepEqual(snapshot.secrets, {
    build: "aws:preview/build",
    deployment: "aws:preview/deployment",
  });
  assert.deepEqual(snapshot.sharedSecrets, { build: [], deployment: [] });
  assert.equal(snapshot.hooks.preDeploy?.secrets, "aws:preview/migrate");
  assert.equal(snapshot.hooks.postDeploy?.secrets, undefined);
  assert.deepEqual(snapshot.hooks.postDeploy?.command, [
    "node",
    "post-deploy.js",
  ]);
});
