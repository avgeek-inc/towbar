import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveRepositoryEnvironment } from "./manifest-v2.js";

void test("the starter repository resolves production and staging separately", () => {
  const root = readFileSync(
    new URL("../../../examples/towbar.yml", import.meta.url),
    "utf8",
  );
  const file = {
    path: ".towbar/services/hello-towbar.service.yml",
    content: readFileSync(
      new URL(
        "../../../examples/.towbar/services/hello-towbar.service.yml",
        import.meta.url,
      ),
      "utf8",
    ),
  };
  const production = resolveRepositoryEnvironment({
    root,
    files: [file],
    environment: "production",
    branch: "main",
  });
  const staging = resolveRepositoryEnvironment({
    root,
    files: [file],
    environment: "staging",
    branch: "develop",
  });
  assert.equal(production.manifest.apps[0]?.server, "192.0.2.10");
  assert.equal(staging.manifest.apps[0]?.server, "192.0.2.11");
  assert.equal(production.manifest.apps[0]?.preview, undefined);
  assert.equal(staging.manifest.apps[0]?.preview?.enabled, true);
});
