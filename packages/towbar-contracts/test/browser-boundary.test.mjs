import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("contracts have no server imports or dependency on core", async () => {
  const pkg = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(pkg.dependencies["@workspace/towbar-core"], undefined);
  for (const file of await readdir(new URL("../src/", import.meta.url))) {
    const source = await readFile(
      new URL(`../src/${file}`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(
      source,
      /(?:from|import\()\s*["'](?:node:|@workspace\/towbar-core)/,
      file,
    );
  }
});
