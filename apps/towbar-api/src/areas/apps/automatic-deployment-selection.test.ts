import assert from "node:assert/strict";
import test from "node:test";

import { selectAutomaticDeploymentCandidates } from "./automatic-deployment-selection.js";

const active = {
  archivedAt: null,
  deploymentDigest: "desired",
  kind: "app" as const,
  serverReady: true,
  sourceRevision: "current",
};

void test("selects changed roots independently by deployment digest", () => {
  const candidates = [
    { ...active, config: { autoDeploy: true }, manifestId: "api" },
    {
      ...active,
      config: { autoDeploy: true },
      deploymentDigest: "web-desired",
      manifestId: "web",
    },
    { ...active, config: { autoDeploy: false }, manifestId: "manual" },
  ];

  assert.deepEqual(
    selectAutomaticDeploymentCandidates({
      candidates,
      commitSha: "current",
      releases: [
        {
          currentDeploymentDigest: "api-old",
          manifestId: "api",
        },
      ],
    }).map((candidate) => candidate.manifestId),
    ["api", "web"],
  );

  assert.deepEqual(
    selectAutomaticDeploymentCandidates({
      candidates,
      commitSha: "current",
      releases: [
        {
          currentDeploymentDigest: "desired",
          manifestId: "api",
        },
      ],
    }).map((candidate) => candidate.manifestId),
    ["web"],
  );
});

void test("excludes apps whose server setup is pending", () => {
  assert.deepEqual(
    selectAutomaticDeploymentCandidates({
      candidates: [
        {
          ...active,
          config: { autoDeploy: true },
          manifestId: "api",
          serverReady: false,
        },
      ],
      commitSha: "current",
      releases: [],
    }),
    [],
  );
});

void test("excludes stale, inactive, already-current, and manual apps", () => {
  const candidates = [
    { ...active, config: { autoDeploy: true }, manifestId: "already-current" },
    {
      ...active,
      config: { autoDeploy: true },
      manifestId: "stale",
      sourceRevision: "old",
    },
    {
      ...active,
      archivedAt: new Date(),
      config: { autoDeploy: true },
      manifestId: "archived",
    },
    {
      ...active,
      config: { autoDeploy: true },
      deploymentDigest: null,
      manifestId: "not-materialized",
    },
    { ...active, config: {}, manifestId: "manual-default" },
  ];

  assert.deepEqual(
    selectAutomaticDeploymentCandidates({
      candidates,
      commitSha: "current",
      releases: [
        {
          currentDeploymentDigest: "desired",
          manifestId: "already-current",
        },
      ],
    }),
    [],
  );
});

void test("uses the same deployment digest rule for Resources", () => {
  const resource = {
    ...active,
    config: { autoDeploy: true },
    deploymentDigest: "resource-v2",
    kind: "postgres" as const,
    manifestId: "database",
  };
  const release = {
    currentDeploymentDigest: "resource-v1",
    manifestId: "database",
  };
  assert.deepEqual(
    selectAutomaticDeploymentCandidates({
      candidates: [resource],
      commitSha: "current",
      releases: [release],
    }).map((candidate) => candidate.manifestId),
    ["database"],
  );
  assert.deepEqual(
    selectAutomaticDeploymentCandidates({
      candidates: [resource],
      commitSha: "current",
      releases: [{ ...release, currentDeploymentDigest: "resource-v2" }],
    }),
    [],
  );
});
