import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeDeploymentManifest,
  releaseCommitSchema,
} from "@workspace/towbar-core";

import { assertReleaseKindMatchesDeployment } from "./release-kind.js";

const manifest = normalizeDeploymentManifest({
  version: 2,
  apps: [
    {
      id: "app",
      name: "App",
      server: "192.0.2.10",
      dockerfile: "Dockerfile",
      container: { port: 3000 },
    },
  ],
  compose: [
    {
      id: "stack",
      name: "Stack",
      server: "192.0.2.10",
      file: "compose.yml",
      services: { web: {} },
    },
  ],
});
const stack = manifest.compose![0]!;
const fields = {
  containerName: "towbar-stack",
  containerNames: ["towbar-stack"],
  imageDigest: `sha256:${"a".repeat(64)}`,
  imageTag: "compose:towbar-stack",
};
const composeRelease = releaseCommitSchema.parse({
  ...fields,
  composeServices: ["web"],
  imagePlatform: "compose",
});
const imageRelease = releaseCommitSchema.parse({
  ...fields,
  imagePlatform: "linux/amd64",
});

void test("the API accepts Compose metadata only for a Compose deployment", () => {
  assert.doesNotThrow(() =>
    assertReleaseKindMatchesDeployment(stack, composeRelease),
  );
  assert.throws(
    () => assertReleaseKindMatchesDeployment(manifest.apps[0]!, composeRelease),
    /release provenance does not match/u,
  );
  assert.throws(
    () => assertReleaseKindMatchesDeployment(stack, imageRelease),
    /release provenance does not match/u,
  );
  assert.doesNotThrow(() =>
    assertReleaseKindMatchesDeployment(manifest.apps[0]!, imageRelease),
  );
});
