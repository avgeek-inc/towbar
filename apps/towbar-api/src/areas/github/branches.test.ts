import assert from "node:assert/strict";
import { test } from "node:test";
import { listRepositoryBranches } from "./branches.js";

void test("branch suggestions paginate using installation authentication and retain slash names", async () => {
  const requests: string[] = [];
  const branches = await listRepositoryBranches(
    { installationId: "42", owner: "example", repository: "service" },
    {
      createToken: (id) => {
        assert.equal(id, "42");
        return Promise.resolve("test-token");
      },
      request: (path, options) => {
        assert.equal(options.token, "test-token");
        requests.push(path);
        return Promise.resolve(
          requests.length === 1
            ? Array.from({ length: 100 }, (_, index) => ({
                name: `branch-${index}`,
              }))
            : [{ name: "release/qa" }],
        );
      },
    },
  );
  assert.equal(requests.length, 2);
  assert.match(
    requests[1]!,
    /\/repos\/example\/service\/branches\?per_page=100&page=2$/,
  );
  assert.equal(branches.length, 101);
  assert(branches.includes("release/qa"));
});

void test("branch fetch errors propagate instead of returning a partial list", async () => {
  let pages = 0;
  await assert.rejects(
    listRepositoryBranches(
      { installationId: "42", owner: "example", repository: "service" },
      {
        createToken: () => Promise.resolve("test-token"),
        request: () => {
          pages += 1;
          return pages === 1
            ? Promise.resolve(
                Array.from({ length: 100 }, (_, index) => ({
                  name: `branch-${index}`,
                })),
              )
            : Promise.reject(new Error("Repository unavailable"));
        },
      },
    ),
    /Repository unavailable/,
  );
});
