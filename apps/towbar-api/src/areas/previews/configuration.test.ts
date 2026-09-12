import assert from "node:assert/strict";
import test from "node:test";
import { resolveRepositoryEnvironment } from "@workspace/towbar-core";
import { resolvePreviewConfiguration } from "./configuration.js";

function resolve(overrides: Record<string, unknown> = {}) {
  return resolveRepositoryEnvironment({
    root: "version: 2\nenvironments:\n  staging:\n    previews:\n      enabled: true\n",
    environment: "staging",
    branch: "develop",
    files: [
      {
        path: ".towbar/apps/site.app.yml",
        content: JSON.stringify({
          id: "site",
          name: "Site",
          dockerfile: "Dockerfile",
          context: ".",
          container: { port: 3000 },
          domains: { primary: "stage.example.com" },
          tls: { mode: "cloudflare-dns" },
          preview: { enabled: true, domain: "preview.example.com" },
          secrets: { runtime: ["TOKEN"] },
          environments: { staging: { server: "stage-host" } },
          ...overrides,
        }),
      },
    ],
  });
}

void test("uses PR build configuration and secret declarations without mutating the target", () => {
  const target = resolve().manifest.apps[0]!;
  const before = structuredClone(target);
  const resolved = resolve({
    dockerfile: "Dockerfile.pr",
    secrets: { build: ["PR_TOKEN"] },
  });
  const preview = resolvePreviewConfiguration({ target, resolved });
  assert(preview);
  assert.equal(preview.config.dockerfile, "Dockerfile.pr");
  assert.deepEqual(preview.requiredSecrets.build, ["PR_TOKEN"]);
  assert.deepEqual(target, before);
  assert.notEqual(
    preview.manifestDigest,
    resolvePreviewConfiguration({ target, resolved: resolve() })!
      .manifestDigest,
  );
});

void test("retains the target infrastructure and preview domain when PR files change them", () => {
  const target = resolve().manifest.apps[0]!;
  const resolved = resolve({
    environments: { staging: { server: "different-host" } },
    preview: { enabled: true, domain: "different.example.com", ttlHours: 1 },
  });
  const preview = resolvePreviewConfiguration({ target, resolved });
  assert(preview);
  assert.equal(preview.config.server, target.server);
  assert.deepEqual(preview.config.preview, target.preview);
});

void test("requires both the target and PR app to opt into previews", () => {
  const target = resolve().manifest.apps[0]!;
  assert.equal(
    resolvePreviewConfiguration({
      target,
      resolved: resolve({ preview: undefined }),
    }),
    null,
  );
  assert.equal(
    resolvePreviewConfiguration({
      target: { ...target, preview: undefined },
      resolved: resolve(),
    }),
    null,
  );
});

void test("does not deploy an app removed from the PR configuration", () => {
  const target = resolve().manifest.apps[0]!;
  const resolved = resolve({ environments: {} });
  assert.equal(resolvePreviewConfiguration({ target, resolved }), null);
});
