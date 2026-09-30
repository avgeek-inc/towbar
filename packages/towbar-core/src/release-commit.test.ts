import assert from "node:assert/strict";
import test from "node:test";

import { releaseCommitSchema } from "./release-commit.js";

const release = {
  containerName: "towbar-example",
  containerNames: ["towbar-example"],
  imageDigest: `sha256:${"a".repeat(64)}`,
  imageTag: "compose:towbar-example",
};

void test("release commit accepts Compose provenance and service inventory", () => {
  assert.deepEqual(
    releaseCommitSchema.parse({
      ...release,
      composeServices: ["web", "worker"],
      imagePlatform: "compose",
    }).composeServices,
    ["web", "worker"],
  );
});

void test("release commit keeps image platforms and Compose metadata distinct", () => {
  assert.equal(
    releaseCommitSchema.parse({
      ...release,
      imagePlatform: "linux/amd64",
    }).imagePlatform,
    "linux/amd64",
  );
  assert.equal(
    releaseCommitSchema.safeParse({
      ...release,
      imagePlatform: "compose",
    }).success,
    false,
  );
  assert.equal(
    releaseCommitSchema.safeParse({
      ...release,
      composeServices: ["web"],
      imagePlatform: "linux/amd64",
    }).success,
    false,
  );
});
