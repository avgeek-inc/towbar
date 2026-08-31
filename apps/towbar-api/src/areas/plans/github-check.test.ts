import assert from "node:assert/strict";
import test from "node:test";

import { renderDeploymentPlanGitHubCheck } from "./github-check.js";

void test("renders a no-op pull request as one neutral GitHub Check", () => {
  const rendered = renderDeploymentPlanGitHubCheck({
    plan: {
      checks: [],
      items: [],
      status: "skipped",
      summary: { archive: 0, create: 0, no_op: 0, restore: 0, update: 0 },
    },
  });
  assert.equal(rendered.conclusion, "neutral");
  assert.equal(rendered.output.title, "No deployment changes");
  assert.match(rendered.output.summary, /No deployment-relevant changes/u);
  assert.match(rendered.output.text, /No deployment-relevant changes/u);
});

void test("renders blocking checks without leaking values", () => {
  const rendered = renderDeploymentPlanGitHubCheck({
    plan: {
      checks: [
        {
          code: "secret_bindings_unavailable",
          message: "Configure Source AWS credentials",
          references: ["aws:source/build"],
          status: "failed",
        },
      ],
      items: [],
      status: "blocked",
      summary: { archive: 0, create: 0, no_op: 0, restore: 0, update: 0 },
    },
  });
  assert.equal(rendered.conclusion, "failure");
  assert.match(rendered.output.text, /Configure Source AWS credentials/u);
  assert.equal(rendered.output.text.includes("aws:source/build"), false);
});
