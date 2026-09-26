import assert from "node:assert/strict";
import { test } from "node:test";

import type { NormalizedDeployable } from "@workspace/towbar-core";
import { resolveExternalSecretSnapshot } from "./external-secret-sources.js";

void test("stored per-key external secret maps fail closed before deployment", async () => {
  const deployable = {
    externalSecrets: {
      API_TOKEN: {
        integration: "doppler",
        secret: "example-api/prd/API_TOKEN",
        use: "runtime",
      },
    },
  } as unknown as NormalizedDeployable;
  await assert.rejects(
    resolveExternalSecretSnapshot({
      deployable,
      stage: "runtime",
      target: {
        environment: "production",
        kind: "repository",
        purpose: "secret",
        repositoryId: "11111111-1111-4111-8111-111111111111",
      },
      workspaceId: "22222222-2222-4222-8222-222222222222",
    }),
    /Stored external secret source is unsupported/u,
  );
});
