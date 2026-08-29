import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyGitHubCheckRuns,
  classifyGitHubPullRequestComments,
} from "./client.js";

const marker = "<!-- towbar:preview-status:source-id:42 -->";

void test("keeps the oldest matching app comment and identifies duplicates", () => {
  const result = classifyGitHubPullRequestComments({
    appId: "1001",
    comments: [
      {
        body: marker,
        id: 30,
        performed_via_github_app: { id: 1001 },
      },
      {
        body: marker,
        id: 10,
        performed_via_github_app: { id: 1001 },
      },
      {
        body: marker,
        id: 5,
        performed_via_github_app: { id: 2002 },
      },
      {
        body: "<!-- towbar:preview-status:source-id:43 -->",
        id: 3,
        performed_via_github_app: { id: 1001 },
      },
    ],
    marker,
  });

  assert.equal(result.canonical?.id, 10);
  assert.deepEqual(
    result.duplicates.map((comment) => comment.id),
    [30],
  );
});

void test("does not adopt a matching marker from another GitHub app", () => {
  const result = classifyGitHubPullRequestComments({
    appId: "1001",
    comments: [
      {
        body: marker,
        id: 10,
        performed_via_github_app: { id: 2002 },
      },
    ],
    marker,
  });

  assert.equal(result.canonical, undefined);
  assert.deepEqual(result.duplicates, []);
});

void test("reuses the Check Run with the matching immutable plan ID", () => {
  const result = classifyGitHubCheckRuns({
    checkRuns: [
      { external_id: "old-plan", id: 10, name: "Towbar deployment plan" },
      { external_id: "current-plan", id: 30, name: "Towbar deployment plan" },
    ],
    externalId: "current-plan",
  });

  assert.equal(result.canonical?.id, 30);
});

void test("adopts the oldest Check Run for the same commit and name", () => {
  const result = classifyGitHubCheckRuns({
    checkRuns: [
      { external_id: "other-plan", id: 30, name: "Towbar deployment plan" },
      { external_id: null, id: 10, name: "Towbar deployment plan" },
    ],
    externalId: "current-plan",
  });

  assert.equal(result.canonical?.id, 10);
});
