import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "../../packages/towbar-core/dist/index.js";
import {
  executeDeployment,
  scanHostKeys,
} from "../../packages/towbar-deployer/dist/index.js";
import { startTestTarget } from "./target.mjs";

const target = await startTestTarget();
const originalFetch = globalThis.fetch;
let database, temporal;
const integrated = Boolean(process.env.TOWBAR_TEST_TEMPORAL_ADDRESS);
if (integrated) {
  process.env.GITHUB_APP_ID = "1001";
  process.env.GITHUB_APP_SLUG = "towbar-test";
  process.env.GITHUB_APP_PRIVATE_KEY = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  })
    .privateKey.export({ type: "pkcs8", format: "pem" })
    .toString();
  process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
}
try {
  const checkout = path.join(target.directory, "checkout");
  mkdirSync(checkout);
  writeFileSync(
    path.join(checkout, "Dockerfile"),
    `FROM python:3.12-alpine
WORKDIR /app
COPY . .
RUN --mount=type=secret,id=BUILD_MARKER test -s /run/secrets/BUILD_MARKER && test -z "$BUILD_MARKER"
CMD ["python", "app.py"]
`,
  );
  writeFileSync(
    path.join(checkout, "app.py"),
    `import os
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write((os.environ["ENV_MARKER"] + ":" + open("revision").read()).encode())
HTTPServer(("0.0.0.0", 8080), Handler).serve_forever()
`,
  );
  const archives = new Map();
  for (const revision of ["a", "b"]) {
    writeFileSync(path.join(checkout, "revision"), revision);
    const archive = path.join(target.directory, `${revision}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", target.directory, "checkout"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    archives.set(revision.repeat(40), readFileSync(archive));
  }
  const fetched = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (integrated && url.origin === process.env.TOWBAR_API_BASE_URL)
      return originalFetch(input, init);
    if (
      integrated &&
      url.origin === "https://api.github.com" &&
      /^\/app\/installations\/[^/]+\/access_tokens$/.test(url.pathname)
    )
      return Response.json({
        token: "test-archive-token",
        expires_at: "2099-01-01T00:00:00Z",
      });
    const match = url.pathname.match(
      /^\/repos\/test\/test\/tarball\/([ab]{40})$/,
    );
    if (url.origin !== "https://api.github.com" || !match)
      throw new Error(`Unexpected archive request: ${url}`);
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer test-archive-token",
    );
    fetched.push(match[1]);
    return new Response(archives.get(match[1]), {
      headers: { "content-type": "application/gzip" },
    });
  };
  const server = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const trustedHostKeys = await scanHostKeys(server);
  if (integrated) {
    const { createResourceLifecycleDatabase } =
      await import("./resource-database.mjs");
    database = await createResourceLifecycleDatabase({
      server,
      trustedHostKeys,
      key: target.key,
      entityType: "app",
    });
    const { startResourceTemporal } = await import("./resource-temporal.mjs");
    temporal = await startResourceTemporal({ serverIp: server.ip });
  }
  const sourceId = randomUUID();
  const instances = new Map(
    (integrated
      ? ["production", "staging"]
      : ["production", "staging", "preview"]
    ).map((name) => [name, { id: randomUUID(), current: null }]),
  );
  const deploy = async (name, revision = "a", failHealth = false) => {
    const instance = instances.get(name);
    const app = normalizeDeploymentManifest({
      version: 2,
      resources: [],
      apps: [
        {
          id: "website",
          name: "Website",
          server: "test",
          dockerfile: "Dockerfile",
          container: {
            port: 8080,
            network: `e2e-${name}`,
            networkAlias: "website",
          },
          health: { path: "/", timeoutSeconds: 10 },
        },
      ],
    }).apps[0];
    if (failHealth)
      app.health = { type: "command", command: ["false"], timeoutSeconds: 2 };
    const previous = instance.current;
    if (integrated) {
      const execution = await database.prepare(
        name,
        app,
        false,
        revision.repeat(40),
      );
      await temporal.execute(execution.deploymentId);
      instance.current = await database.result(execution.deploymentId);
      return instance.current;
    }
    const result = await executeDeployment({
      context: {
        app,
        server,
        trustedHostKeys,
        sourceId,
        deployableId: instance.id,
        runtimeId: instance.id,
        deploymentId: randomUUID(),
        commitSha: revision.repeat(40),
        environment: name === "preview" ? "preview" : "production",
        kind: "deploy",
        githubToken: "test-archive-token",
        repositoryName: "test",
        repositoryOwner: "test",
        rollbackRelease: null,
        currentRelease: previous,
      },
      secrets: {
        build: { BUILD_MARKER: "test-build-value" },
        runtime: { ENV_MARKER: name },
        hooks: { preDeploy: {}, postDeploy: {} },
        cloudflare: null,
        login: { privateKey: readFileSync(target.key, "utf8") },
      },
      hooks: {
        transition: async (state) => console.log(`${name}: ${state}`),
        commitRelease: async (candidate) => ({
          retainedImageTags: [
            candidate.imageTag,
            ...(previous ? [previous.imageTag] : []),
          ],
        }),
      },
    });
    instance.current = result;
    return result;
  };
  const response = (name) => {
    const address = target.ssh(
      `docker port ${instances.get(name).current.containerName} 8080/tcp`,
    );
    assert.match(address, /^127\.0\.0\.1:\d+$/);
    return target.ssh(`curl --fail --silent http://${address}/`);
  };
  for (const name of instances.keys()) await deploy(name);
  for (const name of instances.keys())
    assert.equal(response(name), `${name}:a`);
  const productionContainer = instances.get("production").current.containerName;
  await deploy("staging", "b");
  assert.equal(response("staging"), "staging:b");
  assert.equal(response("production"), "production:a");
  if (!integrated) assert.equal(response("preview"), "preview:a");
  const failedTarget = integrated ? "staging" : "preview";
  const oldPreview = instances.get(failedTarget).current.containerName;
  await assert.rejects(deploy(failedTarget, "b", true));
  assert.equal(instances.get(failedTarget).current.containerName, oldPreview);
  if (!integrated) assert.equal(response("preview"), "preview:a");
  assert.equal(
    instances.get("production").current.containerName,
    productionContainer,
  );
  assert.deepEqual(
    fetched,
    (integrated ? ["a", "a", "b", "b"] : ["a", "a", "a", "b", "b"]).map(
      (value) => value.repeat(40),
    ),
  );
  const running = target
    .ssh("docker ps --format '{{.Names}}'")
    .split("\n")
    .sort();
  assert.deepEqual(
    running,
    [...instances.values()].map((item) => item.current.containerName).sort(),
  );
  if (integrated) {
    await database.verify(instances, "failed");
    await temporal.verify();
    assert.equal(response("staging"), "staging:b");
  }
  console.log(
    integrated
      ? "App admission, worker execution, database releases, environment isolation and failed-candidate recovery verified."
      : "App builds, environment isolation, immutable revisions and failed preview-candidate recovery verified.",
  );
} finally {
  try {
    await temporal?.close();
  } finally {
    try {
      await database?.close();
    } finally {
      globalThis.fetch = originalFetch;
      target.close();
    }
  }
}
