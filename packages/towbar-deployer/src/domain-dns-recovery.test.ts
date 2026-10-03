import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import { rollbackInterruptedDeployment } from "./deployment.js";
import {
  domainDnsRecorder,
  readDomainDnsReceipt,
} from "./domain-dns-recovery.js";
import { type CloudflareDnsChange } from "./cloudflare.js";
import { dnsFixture } from "./cloudflare-dns-test-helper.js";
import { SshSession } from "./ssh.js";
import {
  type DeploymentExecutionContext,
  type DeploymentSecrets,
} from "./types.js";

void test("interrupted handoffs preserve receipts and the candidate when DNS recovery fails", async (t) => {
  const localDirectory = await mkdtemp(
    path.join(os.tmpdir(), "towbar-domain-recovery-"),
  );
  t.after(() => rm(localDirectory, { force: true, recursive: true }));
  const before = {
    id: "record",
    name: "move.example.com",
    type: "A",
    content: "192.0.2.20",
    comment: "Managed by Towbar: api",
    proxied: true,
    ttl: 1,
  };
  const change: CloudflareDnsChange = {
    zoneId: "zone",
    before,
    after: {
      ...before,
      content: "192.0.2.10",
      comment: "Managed by Towbar: ui",
    },
  };
  const context: DeploymentExecutionContext = {
    app: normalizeDeploymentManifest({
      version: 2,
      apps: [
        {
          id: "ui",
          name: "UI",
          server: "192.0.2.10",
          dockerfile: "Dockerfile",
          container: { port: 3000 },
          domains: { primary: before.name },
        },
      ],
    }).apps[0]!,
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    deploymentId: "00000000-0000-4000-8000-000000000000",
    deployableId: "ui",
    serverId: "target",
    sourceId: "source",
    workspaceId: "workspace",
    environmentName: "production",
    kind: "deploy",
    repositoryName: "repo",
    repositoryOwner: "owner",
    sourceCredential: null,
    currentRelease: null,
    rollbackRelease: null,
    trustedHostKeys: [],
    server: normalizeServerConfiguration({
      ip: "192.0.2.10",
      ssh: { username: "deploy" },
    }),
    domainHandoffs: [
      {
        hostname: before.name,
        previousAppId: "api",
        previousAppName: "API",
        previousServerId: "origin",
        previousServerIp: before.content,
        previousDeploymentId: "prior",
        previousManagedDns: true,
      },
    ],
  };
  const secrets: DeploymentSecrets = {
    login: { privateKey: "test" },
    build: {},
    runtime: {},
    cloudflare: { apiToken: "test-token" },
    cloudflareTunnel: null,
    previousCloudflareTunnel: null,
    previousCloudflareTunnelCleanupBlocked: false,
    hooks: { preDeploy: {}, postDeploy: {} },
  };
  let durableReceipt = "[]";
  let candidateRollbackCalls = 0;
  t.mock.method(SshSession, "connect", () =>
    Promise.resolve({
      upload: async (file: string) => {
        durableReceipt = await readFile(file, "utf8");
      },
      run: (script: string) => {
        if (script.includes('cat "$1/domain-dns.json"'))
          return Promise.resolve({ stdout: durableReceipt, stderr: "" });
        candidateRollbackCalls += 1;
        return Promise.resolve({ stdout: "", stderr: "" });
      },
      close: () => Promise.resolve(),
    }),
  );
  const session = await SshSession.connect({
    login: secrets.login,
    server: context.server,
    trustedHostKeys: [],
  });
  const record = domainDnsRecorder({
    context,
    session,
    localDirectory,
    remoteDirectory: "/tmp/stage",
  });
  await record(change);
  assert.deepEqual(await readDomainDnsReceipt(session, "/tmp/stage"), [change]);
  const fixture = dnsFixture([
    { ...change.after, content: "192.0.2.99", proxied: true, ttl: 1 },
  ]);
  t.mock.method(globalThis, "fetch", fixture.fetcher);
  await assert.rejects(
    rollbackInterruptedDeployment({ context, login: secrets.login, secrets }),
    /rollback needs operator attention/,
  );
  assert.equal(
    candidateRollbackCalls,
    0,
    "candidate cleanup must wait for DNS restoration",
  );
  assert.deepEqual(JSON.parse(durableReceipt), [change]);
  assert.equal(fixture.records.get(before.id)!.content, "192.0.2.99");
  fixture.records.set(before.id, { ...change.after, proxied: true, ttl: 1 });
  await rollbackInterruptedDeployment({
    context,
    login: secrets.login,
    secrets,
  });
  assert.equal(candidateRollbackCalls, 1);
  assert.deepEqual(fixture.records.get(before.id), before);
});
