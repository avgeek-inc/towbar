import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";

import { parseDeploymentManifest } from "./manifest.js";

const docs = fileURLToPath(new URL("../../../docs/", import.meta.url));
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory()
      ? files(file)
      : /\.mdx?$/.test(file)
        ? [file]
        : [];
  });
}

const app = {
  id: "web",
  name: "Web",
  server: "203.0.113.10",
  dockerfile: "Dockerfile",
  container: { port: 3000 },
  domains: { primary: "app.example.com" },
  tls: { mode: "direct" },
};

void test("published YAML examples match the deployment parser", () => {
  let checked = 0;
  for (const file of files(docs)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/```yaml[^\n]*\n([\s\S]*?)```/g)) {
      const snippet = match[1]!;
      const value = parse(snippet) as Record<string, unknown>;
      // Fragments deliberately omit required fields. Supply a valid app while
      // preserving every field from the published fragment for validation.
      const complete = value.version
        ? value
        : "apps" in value || "deploymentInputs" in value
          ? {
              version: 1,
              ...value,
              apps: ((value.apps ?? [{}]) as Record<string, unknown>[]).map(
                (item) => ({
                  ...app,
                  ...item,
                }),
              ),
            }
          : { version: 1, apps: [{ ...app, ...value }] };
      assert.doesNotThrow(
        () => parseDeploymentManifest(stringify(complete)),
        `${path.relative(docs, file)}: invalid YAML example`,
      );
      checked++;
    }
  }
  assert.ok(checked >= 10, "Expected complete manifests and feature fragments");
});
