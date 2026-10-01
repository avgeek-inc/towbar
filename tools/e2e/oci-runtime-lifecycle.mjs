import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
try {
  assert(Number(target.ssh("id -u")) > 0);
  assert.equal(target.ssh("id -un"), "deploy");
  target.ssh(`mkdir -p /tmp/oci-image
cat > /tmp/oci-image/Dockerfile <<'DOCKERFILE'
FROM python:3.12-alpine
RUN mkdir /state && chown 1000:1000 /state
USER 1000:1000
ENTRYPOINT ["/bin/false"]
HEALTHCHECK --interval=1s --timeout=1s CMD wget -q -O /dev/null http://127.0.0.1:13133/
DOCKERFILE
docker build -t towbar/oci-fixture:1 /tmp/oci-image`);
  const checkout = path.join(target.directory, "checkout");
  mkdirSync(checkout);
  writeFileSync(
    path.join(checkout, "server.py"),
    `import os, threading
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(open('/etc/oci/value').read().encode())
assert os.getuid() == 1000
assert os.environ.get('RUNTIME_TOKEN')
threading.Thread(target=HTTPServer(('0.0.0.0', 13133), Handler).serve_forever, daemon=True).start()
HTTPServer(('0.0.0.0', 4318), Handler).serve_forever()
`,
  );
  writeFileSync(
    path.join(checkout, "migrate.sh"),
    `#!/bin/sh
set -eu
test -n "$MIGRATION_TOKEN"
test -z "\${RUNTIME_TOKEN:-}"
: > /state/sequence
for step in ready bootstrap sync-up async-up; do echo "$step" >> /state/sequence; done
`,
  );
  writeFileSync(
    path.join(checkout, "redis.conf"),
    "port 6379\nappendonly yes\ndir /data\n",
  );
  const archives = new Map();
  for (const revision of ["a", "b"]) {
    writeFileSync(path.join(checkout, "value"), revision);
    const archive = path.join(target.directory, `${revision}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", target.directory, "checkout"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    archives.set(revision.repeat(40), readFileSync(archive));
  }
  const fetched = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const commit = url.pathname.match(
      /^\/repos\/test\/test\/tarball\/([ab]{40})$/,
    )?.[1];
    assert.equal(url.origin, "https://api.github.com");
    assert(
      commit && archives.has(commit),
      "Only immutable fixture snapshots may be requested",
    );
    assert.equal(
      new Headers(init.headers).get("authorization"),
      "Bearer fixture-token",
    );
    fetched.push(commit);
    return new Response(archives.get(commit));
  };
  const server = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const trustedHostKeys = await scanHostKeys(server);
  const sourceId = randomUUID();
  const serverId = randomUUID();
  const workspaceId = randomUUID();
  const instances = new Map();
  const deploy = async (
    app,
    {
      revision = "a",
      kind = "deploy",
      rollbackRelease = null,
      failCommit = false,
    } = {},
  ) => {
    const instance = instances.get(app.id) ?? {
      id: randomUUID(),
      current: null,
    };
    instances.set(app.id, instance);
    const context = {
      app,
      server,
      trustedHostKeys,
      sourceId,
      serverId,
      workspaceId,
      deployableId: instance.id,
      deploymentId: randomUUID(),
      commitSha: revision.repeat(40),
      environment: "production",
      environmentName: "test",
      kind,
      rollbackRelease,
      currentRelease: instance.current,
      repositoryName: "test",
      repositoryOwner: "test",
      sourceCredential:
        kind === "deploy"
          ? {
              provider: "github",
              apiUrl: "https://api.github.com",
              token: "fixture-token",
            }
          : null,
    };
    const result = await executeDeployment({
      context,
      secrets: {
        login: { privateKey: readFileSync(target.key, "utf8") },
        build: {},
        runtime:
          app.kind === "redis"
            ? { REDIS_PASSWORD: "fixture-runtime-value" }
            : {
                RUNTIME_TOKEN: "fixture-runtime-value",
                TOWBAR_CONTAINER_RUNTIME_JSON: JSON.stringify({
                  configMounts: [
                    "type=bind,src=/var/run/docker.sock,dst=/tmp/socket,readonly",
                  ],
                  entrypoint: "/bin/false",
                }),
              },
        hooks: {
          preDeploy: { MIGRATION_TOKEN: "fixture-hook-value" },
          postDeploy: {},
        },
        cloudflare: null,
      },
      hooks: {
        transition: async (state) => console.log(`${app.id}: ${state}`),
        commitRelease: async (result) => {
          assert(!failCommit);
          return {
            retainedImageTags: [
              result.imageTag,
              ...(instance.current ? [instance.current.imageTag] : []),
            ],
          };
        },
      },
    });
    instance.current = result;
    return { result, context };
  };
  const app = normalizeDeploymentManifest({
    version: 2,
    apps: [
      {
        id: "collector",
        name: "Collector",
        server: server.ip,
        deployment: {
          type: "image",
          image: "towbar/oci-fixture:1",
          pullPolicy: "if-not-present",
        },
        rollout: {
          type: "recreate",
          maintenanceMode: true,
          reason: "Independent singleton",
        },
        container: {
          port: 4318,
          network: "oci-test",
          networkAlias: "collector",
          volumes: [{ name: "state", mountPath: "/state" }],
          entrypoint: "/bin/sh",
          command: [
            "-ec",
            'test "$(tail -n 1 /state/sequence)" = async-up; exec python /etc/oci/server.py',
          ],
          configFiles: [
            { source: "value", mountPath: "/etc/oci/value" },
            { source: "server.py", mountPath: "/etc/oci/server.py" },
            {
              source: "migrate.sh",
              mountPath: "/etc/oci/migrate",
              mode: "0555",
            },
          ],
        },
        health: { path: "/", port: 13133, timeoutSeconds: 10 },
        hooks: {
          preDeploy: {
            entrypoint: "/bin/sh",
            command: ["-ec", "/etc/oci/migrate"],
            timeoutSeconds: 10,
          },
        },
      },
    ],
  }).apps[0];
  const first = await deploy(app);
  const inspect = (name) => JSON.parse(target.ssh(`docker inspect ${name}`))[0];
  const read = (result) =>
    target.ssh(
      `curl --retry 10 --retry-all-errors --retry-delay 1 -fsS http://127.0.0.1:${result.candidatePort}/`,
    );
  assert.equal(read(first.result), "a");
  const firstContainer = inspect(first.result.containerName);
  assert.equal(firstContainer.Config.User, "1000:1000");
  assert.deepEqual(firstContainer.Config.Entrypoint, ["/bin/sh"]);
  assert.deepEqual(firstContainer.Config.Cmd, app.container.command);
  assert.equal(
    firstContainer.Config.Env.some((value) =>
      value.startsWith("MIGRATION_TOKEN="),
    ),
    false,
  );
  assert(
    firstContainer.NetworkSettings.Ports["13133/tcp"][0].HostIp === "127.0.0.1",
  );
  assert.notEqual(
    firstContainer.NetworkSettings.Ports["13133/tcp"][0].HostPort,
    String(first.result.candidatePort),
  );
  const files = firstContainer.Mounts.filter((mount) => mount.Type === "bind");
  assert.equal(files.length, 3);
  assert(files.every((mount) => mount.RW === false));
  assert.equal(
    target.ssh(`docker exec ${first.result.containerName} cat /state/sequence`),
    "ready\nbootstrap\nsync-up\nasync-up",
  );
  assert.equal(
    target.ssh(
      `docker exec ${first.result.containerName} sh -c 'echo bad > /etc/oci/value' 2>/dev/null && exit 1 || echo readonly`,
    ),
    "readonly",
  );
  assert.equal(
    target.ssh(
      `stat -c '%a' ${files.find((mount) => mount.Destination === "/etc/oci/migrate").Source}`,
    ),
    "555",
  );
  const second = await deploy(app, { revision: "b" });
  assert.equal(read(second.result), "b");
  const secondFiles = inspect(second.result.containerName).Mounts.filter(
    (mount) => mount.Type === "bind",
  );
  assert.equal(
    target.ssh(`test -f ${files[0].Source} && echo retained`),
    "retained",
  );
  await assert.rejects(
    deploy(
      {
        ...app,
        health: { type: "command", command: ["false"], timeoutSeconds: 2 },
      },
      { revision: "a" },
    ),
    /health check failed/,
  );
  assert.equal(inspect(second.result.containerName).State.Running, true);
  assert.equal(read(second.result), "b");
  const beforeHooks = target.ssh(
    "docker ps -a --filter name=-hook-predeploy --format '{{.Names}}'",
  );
  assert.equal(beforeHooks, "");
  const badHook = {
    ...app,
    hooks: {
      preDeploy: {
        entrypoint: "/bin/sh",
        command: ["-ec", "echo failing; false; echo should-not-run"],
        timeoutSeconds: 5,
      },
    },
  };
  await assert.rejects(deploy(badHook, { revision: "a" }));
  assert.equal(read(second.result), "b");
  assert.equal(
    target.ssh(
      "docker ps -a --filter name=-hook-predeploy --format '{{.Names}}'",
    ),
    "",
  );
  const fetchedBeforeRollback = fetched.length;
  const rollback = await deploy(app, {
    kind: "rollback",
    revision: "a",
    rollbackRelease: {
      commitSha: first.context.commitSha,
      containerName: first.result.containerName,
      imageTag: first.result.imageTag,
      releaseId: randomUUID(),
      sourceDeploymentId: first.context.deploymentId,
    },
  });
  assert.equal(fetched.length, fetchedBeforeRollback);
  assert.equal(read(rollback.result), "a");
  assert.equal(
    inspect(rollback.result.containerName).Mounts.find(
      (mount) => mount.Destination === "/etc/oci/value",
    ).Source,
    files.find((mount) => mount.Destination === "/etc/oci/value").Source,
  );
  const retainedFile = secondFiles.find(
    (mount) => mount.Destination === "/etc/oci/value",
  ).Source;
  target.ssh(`chmod 440 ${retainedFile}`);
  await assert.rejects(
    deploy(app, {
      kind: "rollback",
      revision: "b",
      rollbackRelease: {
        commitSha: second.context.commitSha,
        containerName: second.result.containerName,
        imageTag: second.result.imageTag,
        releaseId: randomUUID(),
        sourceDeploymentId: second.context.deploymentId,
      },
    }),
    (error) => {
      assert.match(error.stderr, /integrity verification/);
      return true;
    },
  );
  assert.equal(read(rollback.result), "a");
  target.ssh(`chmod 444 ${retainedFile}`);
  const containerHealth = await deploy({
    ...app,
    id: "container-health",
    container: { ...app.container, networkAlias: "container-health" },
    health: { type: "container", timeoutSeconds: 10 },
  });
  assert.equal(
    inspect(containerHealth.result.containerName).State.Running,
    true,
  );
  const redis = normalizeDeploymentManifest({
    version: 2,
    apps: [],
    resources: [
      {
        id: "redis",
        name: "Redis",
        type: "redis",
        server: server.ip,
        container: {
          network: "oci-test",
          entrypoint: "/bin/sh",
          command: [
            "-ec",
            'exec redis-server /etc/redis/fixture.conf --requirepass "$REDIS_PASSWORD"',
          ],
          configFiles: [
            { source: "redis.conf", mountPath: "/etc/redis/fixture.conf" },
          ],
        },
      },
    ],
  }).resources[0];
  const store = await deploy(redis);
  const passwordOption = "-a fixture-runtime-value --no-auth-warning";
  assert.equal(
    target.ssh(
      `docker exec ${store.result.containerName} redis-cli ${passwordOption} SET sentinel data`,
    ),
    "OK",
  );
  await assert.rejects(
    deploy(
      {
        ...redis,
        health: { type: "command", command: ["false"], timeoutSeconds: 2 },
      },
      { revision: "b" },
    ),
    /health check failed/,
  );
  assert.equal(
    target.ssh(
      `docker exec ${store.result.containerName} redis-cli ${passwordOption} GET sentinel`,
    ),
    "data",
  );
  assert.equal(
    inspect(store.result.containerName).Mounts.find(
      (mount) => mount.Destination === "/etc/redis/fixture.conf",
    ).RW,
    false,
  );
  console.log(
    "OCI runtime lifecycle passed: non-root SSH and containers, read-only/executable files, distinct health port, hook ordering and failure, managed datastore config, failed replacement and retained-file rollback.",
  );
} finally {
  globalThis.fetch = originalFetch;
  target.close();
}
