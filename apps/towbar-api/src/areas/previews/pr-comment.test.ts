import assert from "node:assert/strict";
import test from "node:test";

import {
  previewPullRequestCommentMarker,
  renderPreviewPullRequestComment,
} from "./pr-comment.js";

const sourceId = "11111111-1111-4111-8111-111111111111";
const marker = previewPullRequestCommentMarker({
  pullRequestNumber: 42,
  sourceId,
});

void test("uses one stable hidden marker for a Source and pull request", () => {
  assert.equal(
    marker,
    "<!-- towbar:preview-status:11111111-1111-4111-8111-111111111111:42 -->",
  );
});

void test("renders all app previews in one status table", () => {
  const body = renderPreviewPullRequestComment({
    appBaseUrl: "https://app.towbar.dev",
    entries: [
      {
        appName: "Admin | Console",
        deploymentId: "31111111-1111-4111-8111-111111111111",
        deploymentState: "building",
        environmentStatus: "building",
        hostname: "admin-pr-42.preview.example.com",
      },
      {
        appName: "Website",
        deploymentId: "41111111-1111-4111-8111-111111111111",
        deploymentState: "succeeded",
        environmentStatus: "healthy",
        hostname: "website-pr-42.preview.example.com",
      },
    ],
    marker,
    sourceId,
  });
  assert.match(body, /Admin \\| Console \| 🟡 Building/u);
  assert.match(body, /Website \| 🟢 Ready/u);
  assert.match(
    body,
    /\[Open preview\]\(https:\/\/website-pr-42\.preview\.example\.com\)/u,
  );
  assert.equal(body.match(/## Towbar previews/gu)?.length, 1);
});

void test("shows cleanup and failure states without exposing error details", () => {
  const body = renderPreviewPullRequestComment({
    appBaseUrl: "https://app.towbar.dev",
    entries: [
      {
        appName: "API",
        deploymentId: null,
        deploymentState: null,
        environmentStatus: "deleted",
        hostname: "api-pr-42.preview.example.com",
      },
      {
        appName: "Worker",
        deploymentId: null,
        deploymentState: "failed",
        environmentStatus: "failed",
        hostname: "worker-pr-42.preview.example.com",
      },
    ],
    marker,
    sourceId,
  });
  assert.match(body, /API \| ⚪ Cleaned up/u);
  assert.match(body, /Worker \| 🔴 Failed/u);
});
