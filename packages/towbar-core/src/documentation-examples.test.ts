import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import {
  parseRepositoryManifest,
  resolveRepositoryEnvironment,
} from "./manifest-v2.js";

const docs = fileURLToPath(new URL("../../../docs/docs/", import.meta.url));
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

void test("published YAML examples match the v2 repository parser", () => {
  let checked = 0;
  for (const file of files(docs)) {
    for (const match of readFileSync(file, "utf8").matchAll(
      /```yaml[^\n]*\n([\s\S]*?)```/g,
    )) {
      const snippet = match[1]!;
      const value = parse(snippet) as Record<string, unknown>;
      assert.doesNotThrow(
        () => {
          if (value.version) {
            parseRepositoryManifest(snippet);
            return;
          }
          const kind = value.type ? "resource" : "app";
          const entity = {
            id: "web",
            name: "Web",
            server: "production-server",
            ...(kind === "app"
              ? {
                  dockerfile: "Dockerfile",
                  container: { port: 3000 },
                  domains: { primary: "app.example.com" },
                  tls: { mode: "direct" },
                }
              : {}),
            environments: { production: {} },
            ...value,
          };
          const environments = Object.fromEntries(
            Object.keys(entity.environments).map((name) => [
              name,
              { previews: { enabled: true } },
            ]),
          );
          for (const environment of Object.keys(environments))
            resolveRepositoryEnvironment({
              root: stringify({ version: 2, environments }),
              environment,
              branch: "main",
              files: [
                {
                  path: `.towbar/${kind}s/example.${kind}.yml`,
                  content: stringify(entity),
                },
              ],
            });
        },
        `${path.relative(docs, file)}: invalid YAML example`,
      );
      checked++;
    }
  }
  assert.ok(
    checked >= 10,
    "Expected root manifests, entities and feature fragments",
  );
});
