import assert from "node:assert/strict";
import test from "node:test";

import type { NormalizedDeployable } from "@workspace/towbar-core";

import { admitApplicationImage } from "./image-admission.js";

const digest =
  "sha256:85909afc45bdcda1917394594a087421fdbb05610fded0fa9f6fb861abb2f367";

function deployable(image: string): NormalizedDeployable {
  return {
    kind: "app",
    deployment: { type: "image", image, pullPolicy: "if-not-present" },
  } as NormalizedDeployable;
}

async function admit(image: string) {
  return admitApplicationImage({
    deployable: deployable(image),
    environment: "production",
    sourceId: "source-id",
    workspaceId: "workspace-id",
  });
}

void test("admits an image pinned by both tag and digest", async () => {
  const image = `ghcr.io/umami-software/umami:3.4.0@${digest}`;
  const result = await admit(image);

  assert.equal(result.imageDigest, digest);
  assert.equal(result.imageSourceReference, image);
  assert.equal(result.snapshot.deployment?.type, "image");
  assert.equal(result.snapshot.deployment.image, image);
});

void test("preserves registry ports in digest-only image references", async () => {
  const image = `registry.example:5000/team/app@${digest}`;
  const result = await admit(image);

  assert.equal(result.imageDigest, digest);
  assert.equal(result.imageSourceReference, image);
});

void test("rejects an invalid tag even when the image has a digest", async () => {
  await assert.rejects(
    admit(`ghcr.io/umami-software/umami:bad!@${digest}`),
    /The application image tag is invalid/u,
  );
});
