import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "../../packages/towbar-core/dist/index.js";
import {
  CommandError,
  executeComposeDeployment,
  scanHostKeys,
} from "../../packages/towbar-deployer/dist/index.js";
import { composeDeploymentScripts } from "../../packages/towbar-deployer/dist/compose-deployment.js";
import { startTestTarget } from "./target.mjs";

const target = await startTestTarget({ systemd: true });
const directory = mkdtempSync(path.join(tmpdir(), "towbar-compose-lifecycle-"));
const originalFetch = globalThis.fetch;
try {
  assert.notEqual(target.ssh("id -u"), "0");
  target.ssh("sudo install -d -m 0755 /var/lib/towbar");
  assert.equal(
    target.ssh("stat -c '%U:%G %a' /var/lib/towbar"),
    "root:root 755",
  );
  target.ssh("test ! -e /var/lib/towbar/compose");
  target.ssh("sudo ln -s /tmp /var/lib/towbar/compose");
  const storageScript = Buffer.from(
    composeDeploymentScripts.prepareStorage,
  ).toString("base64");
  assert.throws(
    () => target.ssh(`printf '%s' '${storageScript}' | base64 -d | bash -s --`),
    (error) => {
      assert.match(String(error.stderr), /cannot be a symbolic link/u);
      return true;
    },
  );
  target.ssh("sudo rm /var/lib/towbar/compose");

  const checkout = path.join(directory, "checkout");
  mkdirSync(checkout);
  execFileSync("docker", [
    "cp",
    `${target.container}:/usr/bin/caddy`,
    path.join(checkout, "caddy"),
  ]);
  writeFileSync(
    path.join(checkout, "compose.yml"),
    `services:\n  web:\n    build: .\n    healthcheck:\n      test: ["CMD", "/caddy", "version"]\n      interval: 1s\n      timeout: 3s\n      retries: 5\n`,
  );
  const archives = new Map();
  for (const revision of ["a", "b"]) {
    writeFileSync(path.join(checkout, "index.html"), `${revision}\n`);
    writeFileSync(
      path.join(checkout, "Dockerfile"),
      revision === "a"
        ? 'FROM scratch\nCOPY caddy /caddy\nCOPY index.html /www/index.html\nUSER 1000:1000\nCMD ["/caddy", "file-server", "--root", "/www", "--listen", ":8080"]\n'
        : "FROM scratch\nCOPY missing-binary /caddy\n",
    );
    const archive = path.join(directory, `${revision}.tar.gz`);
    execFileSync("tar", ["-czf", archive, "-C", directory, "checkout"], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    archives.set(revision.repeat(40), readFileSync(archive));
  }
  globalThis.fetch = (input) => {
    const url = new URL(String(input));
    const revision = url.pathname.split("/").at(-1);
    assert.equal(url.origin, "https://api.github.com");
    assert(archives.has(revision), `Unexpected Compose source ${url}`);
    return Promise.resolve(new Response(archives.get(revision)));
  };

  const runtimeId = randomUUID();
  const app = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        id: "web",
        name: "Web",
        server: "127.0.0.1",
        file: "compose.yml",
        services: { web: {} },
      },
    ],
  }).compose[0];
  const server = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const trustedHostKeys = await scanHostKeys(server);
  const project = `towbar-${runtimeId}`;
  const liveContent = () => {
    const container = target.ssh(
      `docker ps -q --filter label=com.docker.compose.project=${project} --filter label=com.docker.compose.service=web`,
    );
    assert(container, "Compose service must be running");
    const ip = target.ssh(
      `docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' ${container}`,
    );
    return target.ssh(`curl -fsS http://${ip}:8080/`);
  };
  const deploy = (revision) => {
    const deploymentId = randomUUID();
    const localDirectory = path.join(directory, deploymentId);
    mkdirSync(localDirectory);
    return executeComposeDeployment({
      context: {
        app,
        commitSha: revision.repeat(40),
        deploymentId,
        deployableId: runtimeId,
        environmentName: "production",
        sourceId: randomUUID(),
        workspaceId: randomUUID(),
        runtimeId,
        serverId: randomUUID(),
        kind: "deploy",
        repositoryName: "test",
        repositoryOwner: "test",
        sourceCredential: {
          provider: "github",
          apiUrl: "https://api.github.com",
          token: "test-archive-token",
        },
        server,
        trustedHostKeys,
        rollbackRelease: null,
        currentRelease: null,
      },
      secrets: {
        build: {},
        runtime: {},
        hooks: { preDeploy: {}, postDeploy: {} },
        login: { privateKey: readFileSync(target.key, "utf8") },
        cloudflare: null,
        cloudflareTunnel: null,
        previousCloudflareDns: null,
        previousCloudflareDnsCleanupBlocked: false,
        previousCloudflareTunnel: null,
        previousCloudflareTunnelCleanupBlocked: false,
      },
      hooks: {
        commitRelease: () => Promise.resolve({ retainedImageTags: [] }),
      },
      localDirectory,
    });
  };

  const first = await deploy("a");
  assert.deepEqual(first.composeServices, ["web"]);
  assert.equal(
    target.ssh("stat -c '%U:%G %a' /var/lib/towbar"),
    "root:root 755",
  );
  assert.equal(
    target.ssh("stat -c '%U:%G %a' /var/lib/towbar/compose"),
    "deploy:deploy 700",
  );
  assert.equal(liveContent(), "a");

  await assert.rejects(deploy("b"), (error) => {
    assert(error instanceof CommandError);
    assert.match(error.stderr, /Previous Compose release restarted/u);
    return true;
  });
  assert.equal(liveContent(), "a");
  assert.equal(
    target.ssh(`cat /var/lib/towbar/compose/${runtimeId}/source/index.html`),
    "a",
  );
  target.ssh(
    `printf '%s' '["missing.yml"]' > /var/lib/towbar/compose/${runtimeId}/compose-files.json`,
  );
  target.ssh(
    `docker rm -f ${target.ssh(`docker ps -q --filter label=com.docker.compose.project=${project}`)}`,
  );
  await assert.rejects(deploy("b"), (error) => {
    assert(error instanceof CommandError);
    assert.match(error.stderr, /could not be restarted; operator attention/u);
    return true;
  });
  console.log(
    "Non-root Compose deployment, rollback, and recovery failure reporting passed.",
  );
} finally {
  globalThis.fetch = originalFetch;
  target.close();
  rmSync(directory, { recursive: true, force: true });
}
