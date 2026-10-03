import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { normalizeServerConfiguration } from "@workspace/towbar-core";
import { reconcileCloudflareTunnelRoutes } from "./cloudflare.js";
import { SshSession } from "./ssh.js";

void test("Tunnel handoffs restore address records and recover a lost provider acknowledgment", async (t) => {
  const localDirectory = await mkdtemp(
    path.join(os.tmpdir(), "towbar-tunnel-handoff-"),
  );
  t.after(() => rm(localDirectory, { force: true, recursive: true }));
  t.mock.method(SshSession, "connect", () =>
    Promise.resolve({
      upload: () => Promise.resolve(),
      run: (script: string) =>
        Promise.resolve({
          stdout: script.includes("mktemp -d")
            ? "/tmp/towbar-cloudflared.12345678"
            : "",
          stderr: "",
        }),
      close: () => Promise.resolve(),
    }),
  );
  const session = await SshSession.connect({
    login: { privateKey: "test-key" },
    server: normalizeServerConfiguration({
      ip: "192.0.2.10",
      ssh: { username: "deploy" },
    }),
    trustedHostKeys: [],
  });
  const tunnelId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  for (const type of ["A", "CNAME"]) {
    const before = {
      id: "record",
      name: "move.example.com",
      type,
      content:
        type === "A"
          ? "192.0.2.20"
          : "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.cfargotunnel.com",
      comment: "Managed by Towbar: api",
      proxied: true,
      ttl: 1,
    };
    const record = structuredClone(before);
    let loseAcknowledgment = false;
    const fetcher: typeof fetch = (url, options) => {
      const endpoint = String(url);
      let result: unknown;
      if (endpoint.includes("/dns_records?")) result = [record];
      else if (endpoint.endsWith("/dns_records/record")) {
        Object.assign(record, JSON.parse(String(options?.body)));
        if (loseAcknowledgment && options?.method === "PUT") {
          loseAcknowledgment = false;
          return Promise.reject(new Error("lost provider acknowledgment"));
        }
        result = record;
      } else if (endpoint.includes("/cfd_tunnel?"))
        result = [
          {
            id: tunnelId,
            name: "towbar-ui",
            config_src: "cloudflare",
            metadata: { managed_by: "towbar", towbar_resource_id: "ui" },
          },
        ];
      else if (endpoint.endsWith("/configurations"))
        result = { config: { ingress: [{ service: "http_status:404" }] } };
      else if (endpoint.endsWith("/token")) result = "test-token";
      else throw new Error(`Unexpected provider request: ${endpoint}`);
      return Promise.resolve(
        new Response(JSON.stringify({ success: true, result })),
      );
    };
    const input = {
      accountId: "account",
      apiToken: "test-token",
      appId: "ui",
      access: false,
      image: "test-cloudflared",
      localDirectory,
      session,
      zoneId: "zone",
      hostnames: [before.name],
      fetcher,
      expectedRecords: { [before.name]: before },
      handoffs: [
        {
          hostname: before.name,
          previousAppId: "api",
          previousAppName: "API",
          previousServerId: "previous-server",
          previousServerIp: "192.0.2.20",
          previousDeploymentId: "previous-deployment",
          previousManagedDns: true,
        },
      ],
    };
    const transition = await reconcileCloudflareTunnelRoutes(input);
    assert.equal(record.type, "CNAME");
    assert.equal(record.comment, "Managed by Towbar: ui");
    await transition!.rollback();
    assert.deepEqual(record, before);
    loseAcknowledgment = true;
    await assert.rejects(
      reconcileCloudflareTunnelRoutes(input),
      /Cloudflare could not be reached/,
    );
    assert.deepEqual(record, before);
    const changed = await reconcileCloudflareTunnelRoutes(input);
    record.content = "manually-changed.cfargotunnel.com";
    await assert.rejects(changed!.rollback(), /rollback needs reconciliation/);
    assert.equal(record.content, "manually-changed.cfargotunnel.com");
  }
});

void test("incomplete handoff DNS rollback preserves the tunnel, ingress and connector", async (t) => {
  const localDirectory = await mkdtemp(
    path.join(os.tmpdir(), "towbar-tunnel-preserved-"),
  );
  t.after(() => rm(localDirectory, { force: true, recursive: true }));
  let connectorReady = false;
  let connectorRollbacks = 0;
  t.mock.method(SshSession, "connect", () =>
    Promise.resolve({
      upload: () => Promise.resolve(),
      run: (script: string) => {
        if (script.includes("registered()")) connectorReady = true;
        if (script.includes("ready=false")) {
          connectorReady = false;
          connectorRollbacks += 1;
        }
        return Promise.resolve({
          stdout: script.includes("mktemp -d")
            ? "/tmp/towbar-cloudflared.12345678"
            : "",
          stderr: "",
        });
      },
      close: () => Promise.resolve(),
    }),
  );
  const session = await SshSession.connect({
    login: { privateKey: "test" },
    server: normalizeServerConfiguration({
      ip: "192.0.2.10",
      ssh: { username: "deploy" },
    }),
    trustedHostKeys: [],
  });
  const tunnelId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  for (const created of [false, true]) {
    for (const failureMode of ["write", "rollback"]) {
      connectorReady = false;
      connectorRollbacks = 0;
      let deleted = false;
      let configurationWrites = 0;
      let ingress: unknown = [];
      const before = {
        id: "record",
        name: "move.example.com",
        type: "A",
        content: "192.0.2.20",
        comment: "Managed by Towbar: api",
        proxied: true,
        ttl: 1,
      };
      const record = structuredClone(before);
      const tunnel = {
        id: tunnelId,
        name: "towbar-ui",
        config_src: "cloudflare",
        metadata: { managed_by: "towbar", towbar_resource_id: "ui" },
      };
      const fetcher: typeof fetch = (url, options) => {
        const endpoint = String(url);
        let result: unknown;
        if (endpoint.includes("/dns_records?")) result = [record];
        else if (endpoint.endsWith("/dns_records/record")) {
          if (options?.method === "PATCH")
            return Promise.reject(new Error("DNS restoration unavailable"));
          assert(
            connectorReady,
            "the connector must be ready before DNS cutover",
          );
          Object.assign(record, JSON.parse(String(options?.body)));
          if (failureMode === "write")
            return Promise.reject(new Error("lost DNS write acknowledgment"));
          result = record;
        } else if (endpoint.includes("/cfd_tunnel?"))
          result = created ? [] : [tunnel];
        else if (endpoint.endsWith("/cfd_tunnel") && options?.method === "POST")
          result = tunnel;
        else if (endpoint.endsWith("/configurations")) {
          if (options?.method === "PUT") {
            configurationWrites += 1;
            ingress = JSON.parse(String(options.body)).config.ingress;
          }
          result = { config: { ingress } };
        } else if (endpoint.endsWith("/token")) result = "test-token";
        else if (
          endpoint.endsWith(`/cfd_tunnel/${tunnelId}`) &&
          options?.method === "DELETE"
        ) {
          deleted = true;
          result = {};
        } else throw new Error(`Unexpected provider request: ${endpoint}`);
        return Promise.resolve(
          new Response(JSON.stringify({ success: true, result })),
        );
      };
      const input = {
        accountId: "account",
        apiToken: "test-token",
        appId: "ui",
        access: false,
        image: "test-cloudflared",
        localDirectory,
        session,
        zoneId: "zone",
        hostnames: [before.name],
        expectedRecords: { [before.name]: before },
        fetcher,
        handoffs: [
          {
            hostname: before.name,
            previousAppId: "api",
            previousAppName: "API",
            previousServerId: "old",
            previousServerIp: before.content,
            previousDeploymentId: "old-deployment",
            previousManagedDns: true,
          },
        ],
      };
      if (failureMode === "write")
        await assert.rejects(
          reconcileCloudflareTunnelRoutes(input),
          /rollback needs reconciliation/,
        );
      else {
        const transition = await reconcileCloudflareTunnelRoutes(input);
        record.content = "external-change.cfargotunnel.com";
        await assert.rejects(
          transition!.rollback(),
          /rollback needs reconciliation/,
        );
      }
      assert.equal(deleted, false);
      assert.equal(configurationWrites, 1);
      assert.deepEqual(ingress, [
        {
          hostname: before.name,
          originRequest: { httpHostHeader: before.name },
          service: "http://host.docker.internal:80",
        },
        { service: "http_status:404" },
      ]);
      assert.equal(connectorReady, true);
      assert.equal(connectorRollbacks, 0);
    }
  }
});
