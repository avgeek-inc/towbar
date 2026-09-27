import assert from "node:assert/strict";
import test from "node:test";
import { renderAnalytics } from "./analytics.js";
import type { DeploymentExecutionContext } from "./types.js";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";

void test("analytics ingress excludes previews and strips request data before network logging", () => {
  const manifest = normalizeDeploymentManifest({
    version: 2,
    apps: [
      {
        id: "web",
        name: "Web",
        server: "192.0.2.1",
        dockerfile: "Dockerfile",
        container: { port: 3000 },
        domains: { primary: "example.com" },
        analytics: { enabled: true, pageviews: true },
      },
    ],
  });
  const context = {
    app: manifest.apps[0]!,
    deployableId: "11111111-1111-4111-8111-111111111111",
    environment: "production",
  } as DeploymentExecutionContext;
  const config = renderAnalytics(context).join("\n");
  assert.match(config, /request delete/);
  assert.match(config, /resp_headers delete/);
  assert.match(config, /127.0.0.1:9468/);
  assert.match(config, /header_up X-Towbar-Service/);
  const appendedFields = config
    .split("\n")
    .filter((line) => line.trim().startsWith("log_append "));
  assert.deepEqual(
    appendedFields.map((line) => line.trim().split(" ")[1]),
    ["service", "path", "method", "referrer"],
    "Network-writer stderr fallback must not receive client IP fields",
  );
  assert.deepEqual(renderAnalytics({ ...context, environment: "preview" }), []);
  assert.deepEqual(
    renderAnalytics({
      ...context,
      app: { ...manifest.apps[0]!, analytics: undefined },
    }),
    [],
  );
});
