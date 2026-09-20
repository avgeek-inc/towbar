import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import { resolveRepositoryEnvironment } from "./manifest-v2.js";

const volume = { name: "uploads", mountPath: "/app/uploads" };
function resolve(
  volumes: unknown[],
  overrides?: unknown,
  environment = "production",
) {
  return resolveRepositoryEnvironment({
    root: stringify({
      version: 2,
      environments: { production: {}, staging: {} },
    }),
    branch: "main",
    environment,
    files: [
      {
        path: ".towbar/apps/files.app.yml",
        content: stringify({
          id: "files",
          name: "Files",
          dockerfile: "Dockerfile",
          rollout: {
            type: "recreate",
            reason: "The app uses a single-writer managed volume",
            maintenanceMode: true,
          },
          container: { port: 3000, volumes },
          environments: {
            production: { server: "192.0.2.10" },
            staging: {
              server: "192.0.2.11",
              ...(overrides ? { container: { volumes: overrides } } : {}),
            },
          },
        }),
      },
    ],
  });
}

void test("app storage survives normalization and environment overrides replace lists", () => {
  assert.deepEqual(resolve([volume]).manifest.apps[0]!.container.volumes, [
    volume,
  ]);
  const other = {
    name: "documents",
    mountPath: "/data",
    initialData: "previous-container",
  };
  assert.deepEqual(
    resolve([volume], [other], "staging").manifest.apps[0]!.container.volumes,
    [other],
  );
  assert.equal(
    resolve([volume], [], "staging").manifest.apps[0]!.container.volumes,
    undefined,
  );
  assert.notEqual(
    resolve([volume]).digest,
    resolve([{ ...volume, mountPath: "/files" }]).digest,
  );
});

void test("rejects ambiguous and unsafe app volume declarations", () => {
  for (const mountPath of [
    "/",
    "data",
    "/data/../etc",
    "/data/./uploads",
    "/data//uploads",
    "/data/",
    "/proc",
    "/sys/x",
    "/dev/x",
    "/etc/secrets",
    "/run/docker.sock",
    "/data,readonly",
    "/data:ro",
  ]) {
    assert.throws(() => resolve([{ ...volume, mountPath }]), mountPath);
  }
  for (const values of [
    [volume, volume],
    [volume, { name: "other", mountPath: "/app/uploads/thumbnails" }],
    [volume, { name: "other", mountPath: "/app" }],
    [{ ...volume, name: "../../foreign" }],
    [{ ...volume, initialData: "guess" }],
    [{ ...volume, hostPath: "/etc" }],
  ])
    assert.throws(() => resolve(values));
});
