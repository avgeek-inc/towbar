import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  executeComposeDeployment,
  renderComposeCaddy,
} from "./compose-deployment.js";
import { dnsFixture } from "./cloudflare-dns-test-helper.js";
import {
  DeploymentCommitUncertainError,
  DeploymentCommittedError,
} from "./promotion-boundary.js";
import { SshSession } from "./ssh.js";
import type { DeploymentExecutionContext, DeploymentSecrets } from "./types.js";

async function deploymentFixture(
  t: TestContext,
  failure?: "routing" | "finalize",
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "towbar-compose-tls-"),
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = path.join(directory, "repository");
  const localDirectory = path.join(directory, "deployment");
  await mkdir(repository);
  await mkdir(localDirectory);
  await writeFile(
    path.join(repository, "compose.yml"),
    `services:\n  api:\n    image: nginx@sha256:${"a".repeat(64)}\n  console:\n    image: nginx@sha256:${"a".repeat(64)}\n  direct:\n    image: nginx@sha256:${"a".repeat(64)}\n`,
  );
  const archive = path.join(directory, "source.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", directory, "repository"]);
  const archiveBytes = await readFile(archive);
  const app = normalizeDeploymentManifest({
    version: 2,
    compose: [
      {
        id: "stack",
        name: "Stack",
        server: "192.0.2.10",
        file: "compose.yml",
        services: {
          api: {
            port: 3000,
            domains: ["api.example.com"],
            ingress: { type: "proxy" },
            tls: { mode: "cloudflare-dns" },
          },
          console: {
            port: 8080,
            domains: ["console.example.com"],
            tls: { mode: "cloudflare-dns" },
          },
          direct: {
            port: 80,
            domains: ["direct.example.com"],
            tls: { mode: "direct" },
          },
        },
      },
    ],
  }).compose![0]!;
  const context: DeploymentExecutionContext = {
    app,
    commitSha: "a".repeat(40),
    deploymentId: "deployment",
    deployableId: "stack",
    environmentName: "production",
    sourceId: "source",
    workspaceId: "workspace",
    runtimeId: "stack",
    serverId: "server",
    kind: "deploy",
    repositoryName: "repository",
    repositoryOwner: "owner",
    sourceCredential: {
      provider: "github",
      apiUrl: "https://source.example.com",
      token: "source-token",
    },
    server: normalizeServerConfiguration({
      ip: app.server,
      ssh: { username: "ubuntu" },
    }),
    trustedHostKeys: [],
    rollbackRelease: null,
    currentRelease: null,
  };
  const secrets: DeploymentSecrets = {
    build: {},
    runtime: {},
    hooks: { preDeploy: {}, postDeploy: {} },
    login: { privateKey: "ssh-test-key" },
    cloudflare: { apiToken: "test-token" },
    cloudflareTunnel: null,
    previousCloudflareTunnel: null,
    previousCloudflareTunnelCleanupBlocked: false,
  };
  const fixture = dnsFixture([
    {
      id: "obsolete",
      name: "obsolete.example.com",
      type: "A",
      content: app.server,
      comment: "Managed by Towbar: stack",
      proxied: true,
      ttl: 1,
    },
  ]);
  secrets.previousCloudflareDns = {
    apiToken: "test-token",
    hostnames: ["obsolete.example.com", "api.example.com"],
  };
  t.mock.method(
    globalThis,
    "fetch",
    (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      String(url).startsWith("https://source.example.com/")
        ? Promise.resolve(new Response(archiveBytes))
        : fixture.fetcher(url, init),
  );
  const commands: string[] = [];
  const uploads = new Map<string, string>();
  t.mock.method(SshSession, "connect", () =>
    Promise.resolve({
      upload: async (local: string, remote: string) => {
        if (remote.endsWith("cloudflare.env"))
          assert.equal((await stat(local)).mode & 0o777, 0o600);
        if (remote.endsWith("app.caddy") || remote.endsWith("cloudflare.env"))
          uploads.set(remote, await readFile(local, "utf8"));
      },
      run: (script: string) => {
        commands.push(script);
        if (script.includes("TOWBAR_ROUTING=")) {
          const routes = Object.entries(app.services).map(
            ([service, policy], index) => ({
              service,
              domains: policy.domains,
              ingress: policy.ingress ?? { type: "proxy" },
              tls: policy.tls,
              upstreams: [`127.0.0.1:${40000 + index}`],
            }),
          );
          return Promise.resolve({
            stdout: `TOWBAR_ROUTING=${JSON.stringify(routes)}\nTOWBAR_SERVICES=["api","console","direct"]\n${"a".repeat(64)}\n`,
            stderr: "",
          });
        }
        if (failure === "routing" && script.includes("sudo caddy fmt"))
          throw new Error("Caddy rejected routing");
        if (failure === "finalize" && script.includes('stable="$2"'))
          throw new Error("Finalize failed");
        return Promise.resolve({ stdout: "", stderr: "" });
      },
      close: () => Promise.resolve(),
    }),
  );
  return { ...fixture, commands, uploads, context, secrets, localDirectory };
}

void test("Compose DNS TLS prepares Caddy, transfers its token privately and cleans obsolete DNS after commit", async (t) => {
  const fixture = await deploymentFixture(t);
  let committed = false;
  const result = await executeComposeDeployment({
    ...fixture,
    hooks: {
      commitRelease: () => {
        assert(fixture.records.has("obsolete"));
        committed = true;
        return Promise.resolve({ retainedImageTags: [] });
      },
    },
  });
  assert(committed);
  assert.equal(fixture.records.has("obsolete"), false);
  assert.deepEqual(
    [...fixture.records.values()].map(({ name }) => name),
    ["api.example.com", "console.example.com"],
  );
  const caddy = fixture.uploads.get("/var/lib/towbar/compose/stack/app.caddy")!;
  assert.equal(caddy.match(/dns cloudflare/g)?.length, 2);
  assert.match(caddy, /direct.example.com \{/);
  assert(!caddy.includes("test-token"));
  assert.equal(
    fixture.uploads.get("/var/lib/towbar/compose/stack/cloudflare.env"),
    "CLOUDFLARE_API_TOKEN=test-token\n",
  );
  assert(fixture.commands[0]!.includes("dns.providers.cloudflare"));
  assert.deepEqual(result.warnings, []);
});

void test("routing failure rolls DNS and Compose back before commit without deleting the previous DNS", async (t) => {
  const fixture = await deploymentFixture(t, "routing");
  await assert.rejects(executeComposeDeployment(fixture), /Caddy rejected/);
  assert.deepEqual(
    [...fixture.records.values()].map(({ name }) => name),
    ["obsolete.example.com"],
  );
  assert(fixture.commands.some((script) => script.includes('runtime="$6"')));
});

void test("an uncertain release commit preserves the candidate DNS and rollback state", async (t) => {
  const fixture = await deploymentFixture(t);
  await assert.rejects(
    executeComposeDeployment({
      ...fixture,
      hooks: {
        commitRelease: () => Promise.reject(new Error("Lost commit response")),
      },
    }),
    DeploymentCommitUncertainError,
  );
  assert.equal(fixture.records.size, 3);
  assert(!fixture.commands.some((script) => script.includes('runtime="$6"')));
  assert(!fixture.mutations.some(({ method }) => method === "DELETE"));
});

void test("post-commit finalization failure preserves the live DNS and runtime", async (t) => {
  const fixture = await deploymentFixture(t, "finalize");
  await assert.rejects(
    executeComposeDeployment(fixture),
    DeploymentCommittedError,
  );
  assert.equal(fixture.records.size, 2);
  assert(!fixture.commands.some((script) => script.includes('runtime="$6"')));
});

void test("missing previous credentials produce a cleanup warning after a successful release", async (t) => {
  const fixture = await deploymentFixture(t);
  fixture.secrets.previousCloudflareDnsCleanupBlocked = true;
  const result = await executeComposeDeployment(fixture);
  assert(
    result.warnings.some((warning) =>
      warning.includes("DNS records need cleanup"),
    ),
  );
  assert.equal(fixture.records.size, 3);
});

void test("Compose renders Tunnel HTTP and legacy direct TLS alongside DNS TLS", () => {
  const caddy = renderComposeCaddy([
    {
      domains: ["tunnel.example.com"],
      ingress: { type: "cloudflare-tunnel" },
      upstreams: ["127.0.0.1:40001"],
    },
    {
      domains: ["legacy.example.com"],
      ingress: { type: "proxy" },
      upstreams: ["127.0.0.1:40002"],
    },
    {
      domains: ["dns.example.com"],
      ingress: { type: "proxy" },
      upstreams: ["127.0.0.1:40003"],
      tls: { mode: "cloudflare-dns" },
    },
  ]);
  assert.match(caddy, /http:\/\/tunnel.example.com/);
  assert.equal(caddy.match(/dns cloudflare/g)?.length, 1);
});
