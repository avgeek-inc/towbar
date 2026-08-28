import assert from "node:assert/strict";
import test from "node:test";

import {
  previewPullRequestDisposition,
  previewPullRequestsToReconcile,
} from "./pull-request.js";

import type { GitHubPullRequest } from "../github/client.js";

const pullRequest: GitHubPullRequest = {
  baseBranch: "main",
  baseRepository: "avgeek-inc/example",
  changedFileCount: 1,
  draft: false,
  headBranch: "feature/preview",
  headRepository: "avgeek-inc/example",
  headSha: "a".repeat(40),
  merged: false,
  number: 42,
  state: "open",
};

const source = {
  repositoryName: "example",
  repositoryOwner: "avgeek-inc",
  sourceBranch: "main",
};

void test("deploys open same-repository pull requests targeting the Source branch", () => {
  assert.deepEqual(previewPullRequestDisposition({ pullRequest, ...source }), {
    action: "deploy",
  });
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: { ...pullRequest, draft: true },
      ...source,
    }),
    { action: "deploy" },
  );
});

void test("cleans up merged and closed pull requests with specific reasons", () => {
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: { ...pullRequest, merged: true, state: "closed" },
      ...source,
    }),
    { action: "cleanup", reason: "Pull request #42 was merged" },
  );
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: { ...pullRequest, state: "closed" },
      ...source,
    }),
    { action: "cleanup", reason: "Pull request #42 was closed" },
  );
});

void test("rejects fork pull requests and retargeted pull requests", () => {
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: {
        ...pullRequest,
        headRepository: "contributor/example",
      },
      ...source,
    }),
    {
      action: "cleanup",
      reason:
        "Preview deployments are unavailable for pull requests from forks",
    },
  );
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: { ...pullRequest, headRepository: null },
      ...source,
    }),
    {
      action: "cleanup",
      reason:
        "Preview deployments are unavailable for pull requests from forks",
    },
  );
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: {
        ...pullRequest,
        baseRepository: "avgeek-inc/other",
      },
      ...source,
    }),
    {
      action: "cleanup",
      reason: "The pull request no longer targets the Source repository",
    },
  );
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: { ...pullRequest, baseBranch: "release" },
      ...source,
    }),
    {
      action: "cleanup",
      reason: "The pull request no longer targets 'main'",
    },
  );
});

void test("matches GitHub repository names case-insensitively", () => {
  assert.deepEqual(
    previewPullRequestDisposition({
      pullRequest: {
        ...pullRequest,
        baseRepository: "Avgeek-Inc/Example",
        headRepository: "AVGeek-Inc/EXAMPLE",
      },
      ...source,
    }),
    { action: "deploy" },
  );
});

void test("reconciles open pull requests and existing environments once", () => {
  assert.deepEqual(
    previewPullRequestsToReconcile([42, 43], [41, 42]),
    [42, 43, 41],
  );
});
