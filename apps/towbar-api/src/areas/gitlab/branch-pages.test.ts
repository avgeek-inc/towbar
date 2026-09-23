import assert from "node:assert/strict";
import { test } from "node:test";
import { collectGitLabBranches } from "./branch-pages.js";

void test("GitLab branch listing follows the next-page header even for a short page", async () => {
  const requested: number[] = [];
  const branches = await collectGitLabBranches({
    maxPages: 20,
    readJson: (response) => response.json(),
    requestPage: (page) => {
      requested.push(page);
      return Promise.resolve(
        Response.json(
          page === 1 ? [{ name: "feature/first" }] : [{ name: "production" }],
          { headers: { "x-next-page": page === 1 ? "2" : "" } },
        ),
      );
    },
    tooManyError: new Error("Too many branches"),
  });

  assert.deepEqual(requested, [1, 2]);
  assert.deepEqual(branches, ["feature/first", "production"]);
});

void test("GitLab branch listing continues after a full page without pagination headers", async () => {
  const requested: number[] = [];
  const branches = await collectGitLabBranches({
    maxPages: 20,
    readJson: (response) => response.json(),
    requestPage: (page) => {
      requested.push(page);
      return Promise.resolve(
        Response.json(
          page === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                name: `feature/${index}`,
              }))
            : [{ name: "production" }],
        ),
      );
    },
    tooManyError: new Error("Too many branches"),
  });

  assert.deepEqual(requested, [1, 2]);
  assert.equal(branches.length, 101);
  assert(branches.includes("production"));
});
