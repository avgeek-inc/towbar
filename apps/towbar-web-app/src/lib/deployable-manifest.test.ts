import assert from "node:assert/strict";
import test from "node:test";
import {
  findDeployableManifest,
  type ManifestFile,
} from "./deployable-manifest";

const files: ManifestFile[] = [
  { path: "towbar.yml", content: "version: 2\nid: api\n" },
  { path: ".towbar/services/api.service.yml", content: "id: other\n" },
  {
    path: ".towbar/services/nested/workload.service.yml",
    content: 'id: "api"\nname: API\n',
  },
  { path: ".towbar/services/stack.compose.yml", content: "id: api\n" },
  { path: ".towbar/datastores/db.datastore.yml", content: "id: api\n" },
];

void test("finds a service by declared ID, including nested paths and quoted IDs", () => {
  assert.equal(
    findDeployableManifest(files, {
      kind: "app",
      manifestId: "api",
      environment: null,
    }),
    files[2],
  );
});

void test("keeps service, Compose, and datastore manifests separate for shared IDs", () => {
  assert.equal(
    findDeployableManifest(files, {
      kind: "compose",
      manifestId: "api",
      environment: null,
    }),
    files[3],
  );
  assert.equal(
    findDeployableManifest(files, {
      kind: "postgres",
      manifestId: "api",
      environment: null,
    }),
    files[4],
  );
});

void test("does not substitute another workload when a manifest is missing or invalid", () => {
  const deployable = {
    kind: "app",
    manifestId: "missing",
    environment: null,
  } as const;
  assert.equal(findDeployableManifest(files, deployable), undefined);
  assert.equal(findDeployableManifest([], deployable), undefined);
  assert.equal(
    findDeployableManifest(
      [
        {
          path: ".towbar/services/missing.service.yml",
          content: "id: [broken",
        },
      ],
      deployable,
    ),
    undefined,
  );
});
