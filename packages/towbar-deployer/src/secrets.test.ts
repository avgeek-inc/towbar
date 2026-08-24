import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collectSensitiveValues,
  redactSensitiveValues,
  validateDeploymentSecrets,
} from "./secrets.js";

import type { DeploymentSecrets } from "./types.js";

function secrets(
  overrides: Partial<DeploymentSecrets> = {},
): DeploymentSecrets {
  return {
    build: { BUILD_TOKEN: "build-secret" },
    cloudflare: { apiToken: "cloudflare-secret" },
    hooks: {
      postDeploy: { POST_TOKEN: "post-secret" },
      preDeploy: { MIGRATION_TOKEN: "migration-secret" },
    },
    login: { privateKey: "private-key" },
    runtime: { RUNTIME_TOKEN: "runtime-secret" },
    ...overrides,
  };
}

void describe("deployment secrets", () => {
  void it("rejects unsafe keys and reserved aggregate build secrets", () => {
    assert.throws(
      () => validateDeploymentSecrets(secrets({ runtime: { "BAD-KEY": "x" } })),
      /invalid environment key/u,
    );
    assert.throws(
      () =>
        validateDeploymentSecrets(
          secrets({ build: { TOWBAR_BUILD_ENV_JSON: "reserved" } }),
        ),
      /reserved for Towbar's aggregate build secret/u,
    );
  });

  void it("accepts multiline runtime values", () => {
    assert.doesNotThrow(() =>
      validateDeploymentSecrets(
        secrets({ runtime: { GOOGLE_CREDENTIALS: "first\nsecond\r\n" } }),
      ),
    );
  });

  void it("redacts every credential class before a log leaves the worker", () => {
    const deploymentSecrets = secrets();
    const content = [
      deploymentSecrets.login.privateKey,
      deploymentSecrets.cloudflare?.apiToken,
      deploymentSecrets.build.BUILD_TOKEN,
      deploymentSecrets.hooks.preDeploy.MIGRATION_TOKEN,
      deploymentSecrets.hooks.postDeploy.POST_TOKEN,
      deploymentSecrets.runtime.RUNTIME_TOKEN,
    ].join(" ");
    const redacted = redactSensitiveValues(
      content,
      collectSensitiveValues(deploymentSecrets),
    );
    assert.equal(
      redacted,
      "[REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED]",
    );
  });
});
