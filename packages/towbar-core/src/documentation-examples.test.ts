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
      /```yaml([^\n]*)\n([\s\S]*?)```/g,
    )) {
      const header = match[1]!;
      const snippet = match[2]!;
      const value = parse(snippet) as Record<string, unknown>;
      if (header.includes("/etc/towbar/towbar.yml")) continue;
      assert.doesNotThrow(
        () => {
          if (value.version) {
            parseRepositoryManifest(snippet);
            return;
          }
          const kind = header.includes(".compose.yml")
            ? "compose"
            : header.includes(".resource.yml") || value.type || value.backup
              ? "resource"
              : "app";
          const container: Record<string, unknown> =
            value.container &&
            typeof value.container === "object" &&
            !Array.isArray(value.container)
              ? (value.container as Record<string, unknown>)
              : {};
          const entity = {
            id: "web",
            name: "Web",
            server: "192.0.2.10",
            environments: { production: {} },
            ...value,
            ...(kind === "resource" ? { type: "postgres" } : {}),
            ...(kind === "compose"
              ? { file: "compose.yml", services: {} }
              : {}),
            ...(kind === "app"
              ? {
                  ...(!value.deployment ? { dockerfile: "Dockerfile" } : {}),
                  container: { port: 3000, ...container },
                  domains: value.domains ?? { primary: "app.example.com" },
                  tls: value.tls ?? { mode: "direct" },
                  ...(Array.isArray(container.volumes) && !value.rollout
                    ? {
                        rollout: {
                          type: "recreate",
                          maintenanceMode: true,
                          reason: "The app uses a single-writer volume",
                        },
                      }
                    : {}),
                }
              : {}),
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
                  path: `.towbar/${kind === "compose" ? "compose" : `${kind}s`}/example.${kind}.yml`,
                  content: stringify(entity),
                },
              ],
            });
        },
        `${path.relative(docs, file)} (${header.trim() || "untitled"}, ${snippet.split("\n")[0]}): invalid YAML example`,
      );
      checked++;
    }
  }
  assert.ok(
    checked >= 10,
    "Expected root manifests, entities and feature fragments",
  );
});
