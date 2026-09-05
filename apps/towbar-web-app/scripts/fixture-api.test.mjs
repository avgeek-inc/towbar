import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { createFixtureApiServer, fixtureIds } from "./fixture-api.ts";
import { reconcileServerSetupStatus } from "../src/lib/server-preparation-status.ts";

const readRoutes = [
  "/v1/core/session",
  "/v1/core/profile",
  "/v1/core/sessions",
  "/v1/core/github",
  "/v1/core/notifications/providers",
  "/v1/core/github/repositories",
  "/v1/core/sources",
  "/v1/core/apps",
  "/v1/core/resources",
  "/v1/core/servers",
  "/v1/core/deployments",
  "/v1/core/deployments/history",
  "/v1/core/system-health",
  "/v1/core/aws",
  "/v1/core/settings/secrets",
  `/v1/core/sources/${fixtureIds.source}`,
  `/v1/core/sources/${fixtureIds.source}/manifest`,
  `/v1/core/sources/${fixtureIds.source}/syncs`,
  `/v1/core/sources/${fixtureIds.source}/auto-deploy-control`,
  `/v1/core/sources/${fixtureIds.source}/secrets`,
  `/v1/core/sources/${fixtureIds.source}/apps`,
  `/v1/core/sources/${fixtureIds.source}/capacity`,
  `/v1/core/sources/${fixtureIds.source}/resources`,
  `/v1/core/sources/${fixtureIds.source}/deployments`,
  `/v1/core/sources/${fixtureIds.source}/backups`,
  `/v1/core/sources/${fixtureIds.source}/syncs/${fixtureIds.sync}`,
  `/v1/core/apps/${fixtureIds.app}`,
  `/v1/core/apps/${fixtureIds.app}/auto-deploy-control`,
  `/v1/core/apps/${fixtureIds.app}/secrets`,
  `/v1/core/apps/${fixtureIds.app}/deployments`,
  `/v1/core/apps/${fixtureIds.app}/releases`,
  `/v1/core/apps/${fixtureIds.app}/operations`,
  `/v1/core/resources/${fixtureIds.resource}`,
  `/v1/core/resources/${fixtureIds.resource}/auto-deploy-control`,
  `/v1/core/resources/${fixtureIds.resource}/secrets`,
  `/v1/core/resources/${fixtureIds.resource}/deployments`,
  `/v1/core/resources/${fixtureIds.resource}/releases`,
  `/v1/core/resources/${fixtureIds.resource}/operations`,
  `/v1/core/servers/${fixtureIds.server}`,
  `/v1/core/servers/${fixtureIds.server}/apps`,
  `/v1/core/servers/${fixtureIds.server}/resources`,
  `/v1/core/servers/${fixtureIds.server}/deployments`,
  `/v1/core/servers/${fixtureIds.server}/capacity`,
  `/v1/core/servers/${fixtureIds.server}/checks`,
  `/v1/core/servers/${fixtureIds.server}/preparations`,
  `/v1/core/servers/${fixtureIds.server}/host-keys`,
  `/v1/core/servers/${fixtureIds.server}/orphans`,
  `/v1/core/deployments/${fixtureIds.deployment}`,
  `/v1/core/deployments/${fixtureIds.deployment}/steps`,
  `/v1/core/deployments/${fixtureIds.deployment}/logs`,
];

test("terminal preparation state replaces a stale preparing server state", () => {
  assert.equal(reconcileServerSetupStatus("preparing", "failed"), "failed");
  assert.equal(reconcileServerSetupStatus("preparing", "succeeded"), "ready");
  assert.equal(reconcileServerSetupStatus("preparing", "running"), "preparing");
  assert.equal(reconcileServerSetupStatus("pending", "succeeded"), "pending");
});

test("the local fixture permits credentialed CORS only from exact web fixture origins", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (const origin of [
      "http://127.0.0.1:4021",
      "http://[::1]:4021",
      "http://localhost:4021",
    ]) {
      const response = await fetch(`${baseUrl}/v1/core/session`, {
        headers: { origin },
      });
      assert.equal(response.status, 200, origin);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      assert.equal(
        response.headers.get("access-control-allow-credentials"),
        "true",
      );
      assert.match(response.headers.get("vary") ?? "", /\bOrigin\b/u);
    }

    const toolingResponse = await fetch(`${baseUrl}/v1/core/session`);
    assert.equal(toolingResponse.status, 200);
    assert.equal(
      toolingResponse.headers.get("access-control-allow-origin"),
      null,
    );
    assert.equal(
      toolingResponse.headers.get("access-control-allow-credentials"),
      null,
    );
    assert.match(toolingResponse.headers.get("vary") ?? "", /\bOrigin\b/u);

    const preflight = await fetch(`${baseUrl}/v1/core/session`, {
      headers: { origin: "http://localhost:4021" },
      method: "OPTIONS",
    });
    assert.equal(preflight.status, 204);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture rejects disallowed origins before state changes", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const route = `/v1/core/apps/${fixtureIds.app}/auto-deploy-control`;

  try {
    const beforeResponse = await fetch(`${baseUrl}${route}`);
    assert.equal(beforeResponse.status, 200);
    const before = await beforeResponse.json();

    for (const origin of [
      "null",
      "http://localhost:4022",
      "http://localhost.evil.example:4021",
      "http://localhost:4021@evil.example",
      "not-an-origin",
    ]) {
      const response = await fetch(`${baseUrl}${route}`, {
        body: JSON.stringify({ paused: !before.autoDeploy.paused }),
        headers: { "content-type": "application/json", origin },
        method: "PATCH",
      });
      assert.equal(response.status, 403, origin);
      assert.equal(
        response.headers.get("access-control-allow-origin"),
        null,
        origin,
      );
      assert.equal(
        response.headers.get("access-control-allow-credentials"),
        null,
        origin,
      );
    }

    const preflight = await fetch(`${baseUrl}${route}`, {
      headers: { origin: "https://attacker.example" },
      method: "OPTIONS",
    });
    assert.equal(preflight.status, 403);

    const afterResponse = await fetch(`${baseUrl}${route}`);
    assert.equal(afterResponse.status, 200);
    const after = await afterResponse.json();
    assert.equal(after.autoDeploy.paused, before.autoDeploy.paused);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("health checks include AWS only while the integration is connected", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}/v1/core`;
  try {
    const read = async () => (await fetch(`${base}/system-health`)).json();
    assert.equal(
      (await read()).checks.some((check) => check.id === "aws"),
      false,
    );
    const saved = await fetch(`${base}/aws`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        accessKeyId: "fixture-key",
        region: "ap-south-1",
      }),
    });
    assert.equal(saved.status, 200);
    const connected = (await read()).checks.find((check) => check.id === "aws");
    assert.equal(connected.status, "healthy");
    const checked = await (
      await fetch(`${base}/system-health/actions/check`, { method: "POST" })
    ).json();
    assert.equal(
      checked.checks.filter((check) => check.id === "aws").length,
      1,
    );
    assert.equal(
      checked.checks.find((check) => check.id === "aws").checkedAt,
      checked.checkedAt,
    );
    await fetch(`${base}/aws`, { method: "DELETE" });
    assert.equal(
      (await read()).checks.some((check) => check.id === "aws"),
      false,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture separates control-plane checks from server capacity", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/core/system-health/actions/check`,
      { method: "POST" },
    );
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.checks.length, 4);
    assert.equal(
      health.checks.some((check) => check.id === "aws"),
      false,
    );
    assert.equal("runtimeCapacity" in health, false);
    const capacityResponse = await fetch(
      `http://127.0.0.1:${address.port}/v1/core/servers/${fixtureIds.server}/capacity`,
    );
    assert.equal(capacityResponse.status, 200);
    const { capacity } = await capacityResponse.json();
    assert.equal(capacity.id, fixtureIds.server);
    assert.equal(capacity.runtimes.length > 0, true);
    const sourceCapacityResponse = await fetch(
      `http://127.0.0.1:${address.port}/v1/core/sources/${fixtureIds.source}/capacity`,
    );
    assert.equal(sourceCapacityResponse.status, 200);
    const { capacities } = await sourceCapacityResponse.json();
    assert.equal(capacities.length, 2);
    assert.equal(
      capacities.some((item) =>
        item.runtimes.some((runtime) => runtime.id === fixtureIds.app),
      ),
      true,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture covers every authenticated page read contract", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    for (const route of readRoutes) {
      const response = await fetch(`http://127.0.0.1:${address.port}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type") ?? "", /json/, route);
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture supports automatic deployment control edits", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(
      `${baseUrl}/v1/core/apps/${fixtureIds.app}/auto-deploy-control`,
      {
        body: JSON.stringify({
          paused: true,
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.autoDeploy.paused, true);
    assert.equal(result.autoDeploy.effective.paused, true);
    assert.equal(result.autoDeploy.effective.scope, "deployable");
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture supports write-only stage edits and rejects stale revisions", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const endpoint = `${baseUrl}/v1/core/apps/${fixtureIds.app}/secrets`;
    const initial = await (await fetch(endpoint)).json();
    const binding = initial.bindings.find(
      (item) => item.stage === "deployment",
    );
    assert(binding);
    const body = JSON.stringify({
      expectedRevision: binding.revision,
      set: { TEST_TOKEN: "must-not-return" },
      delete: [],
    });
    const request = {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body,
    };
    const updated = await fetch(`${endpoint}/production/deployment`, request);
    assert.equal(updated.status, 200);
    assert.equal((await updated.text()).includes("must-not-return"), false);
    assert.equal(
      (await fetch(`${endpoint}/production/deployment`, request)).status,
      409,
    );
    assert.equal(
      (await fetch(`${endpoint}/reveal`, { method: "POST" })).status,
      404,
    );
    const preview = await (
      await fetch(`${endpoint}?environment=preview`)
    ).json();
    assert(preview.bindings.every((item) => item.environment === "preview"));
    const previewBuild = preview.bindings.find(
      (item) => item.stage === "build",
    );
    assert.deepEqual(previewBuild.inheritedKeys, [
      "GLOBAL_PREVIEW_TOKEN",
      "SOURCE_PREVIEW_TOKEN",
    ]);
    assert.equal(previewBuild.inheritedOrigins.GLOBAL_PREVIEW_TOKEN, "global");
    assert.equal(previewBuild.inheritedOrigins.SOURCE_PREVIEW_TOKEN, "source");

    const globalEndpoint = `${baseUrl}/v1/core/settings/secrets`;
    const global = await (await fetch(globalEndpoint)).json();
    const globalBuild = global.bindings.find((item) => item.stage === "build");
    const globalUpdate = await fetch(`${globalEndpoint}/production/build`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedRevision: globalBuild.revision,
        set: { GLOBAL_WRITE_ONLY: "must-also-not-return" },
        delete: [],
      }),
    });
    assert.equal(globalUpdate.status, 200);
    assert.equal(
      (await globalUpdate.text()).includes("must-also-not-return"),
      false,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture covers source creation and the initial sync", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const createResponse = await fetch(`${baseUrl}/v1/core/sources`, {
      body: JSON.stringify({
        branch: "main",
        githubInstallationId: "b1111111-1111-4111-8111-111111111111",
        repositoryName: "platform",
        repositoryOwner: "example-inc",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(createResponse.status, 201);
    const createPayload = await createResponse.json();
    assert.equal(createPayload.source.id, fixtureIds.source);

    const syncResponse = await fetch(
      `${baseUrl}/v1/core/sources/${createPayload.source.id}/actions/sync`,
      { method: "POST" },
    );
    assert.equal(syncResponse.status, 202);
    const syncPayload = await syncResponse.json();
    assert.equal(syncPayload.sync.id, fixtureIds.sync);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture models one write-only workspace AWS integration", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const endpoint = `${baseUrl}/v1/core/aws`;

  try {
    const empty = await (await fetch(endpoint)).json();
    assert.equal(empty.credential, null);

    const savedResponse = await fetch(endpoint, {
      body: JSON.stringify({
        accessKeyId: "AKIAEXAMPLE123456",
        region: "ap-south-1",
        secretAccessKey: "must-not-return-secret-value",
      }),
      headers: { "content-type": "application/json" },
      method: "PUT",
    });
    assert.equal(savedResponse.status, 200);
    const savedText = await savedResponse.text();
    assert.equal(savedText.includes("must-not-return-secret-value"), false);
    assert.equal(JSON.parse(savedText).credential.accessKeyIdSuffix, "3456");

    const assurance = await (
      await fetch(
        `${baseUrl}/v1/core/resources/${fixtureIds.resource}/backup-assurance`,
      )
    ).json();
    assert.equal(assurance.awsConfigured, true);

    assert.equal((await fetch(endpoint, { method: "DELETE" })).status, 204);
    assert.equal((await (await fetch(endpoint)).json()).credential, null);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture supports workspace server creation and editing but not removal", async () => {
  const fixture = createFixtureApiServer();
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const baseUrl = `http://127.0.0.1:${fixture.address().port}`;
  const config = {
    buildConcurrency: 2,
    previewBuildConcurrency: 1,
    ip: "192.0.2.50",
    ssh: { port: 22, username: "deploy" },
  };

  try {
    const createdResponse = await fetch(`${baseUrl}/v1/core/servers`, {
      body: JSON.stringify(config),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(createdResponse.status, 201);
    const created = (await createdResponse.json()).server;
    assert.equal(created.canonicalIp, config.ip);
    assert.equal("sourceId" in created, false);

    const duplicate = await fetch(`${baseUrl}/v1/core/servers`, {
      body: JSON.stringify(config),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    assert.equal(duplicate.status, 409);

    const updatedResponse = await fetch(
      `${baseUrl}/v1/core/servers/${created.id}`,
      {
        body: JSON.stringify({
          ...config,
          buildConcurrency: 4,
          proxy: { cloudflare: { enabled: true } },
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    assert.equal(updatedResponse.status, 200);
    const updated = (await updatedResponse.json()).server;
    assert.equal(updated.config.buildConcurrency, 4);
    assert.equal(updated.config.proxy.cloudflare.enabled, true);

    assert.equal(
      (
        await fetch(`${baseUrl}/v1/core/servers/${created.id}`, {
          method: "DELETE",
        })
      ).status,
      404,
    );
    const retained = await fetch(`${baseUrl}/v1/core/servers/${created.id}`);
    assert.equal(retained.status, 200);
    assert.equal((await retained.json()).server.id, created.id);
  } finally {
    fixture.close();
    await once(fixture, "close");
  }
});

test("the local fixture covers deployment trigger presentation", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/core/apps/${fixtureIds.app}/deployments`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    const triggers = new Set(
      payload.deployments.map((deployment) => deployment.trigger),
    );
    assert.deepEqual([...triggers].sort(), [
      "auto_deploy",
      "manual",
      "rollback",
    ]);
    assert.equal(
      payload.deployments.some((deployment) => "requestedBy" in deployment),
      false,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture covers retained backups from multiple Resources", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/core/sources/${fixtureIds.source}/backups`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.backups.length, 3);
    assert.equal(
      payload.backups.some(
        (backup) => backup.resourceId === fixtureIds.resource,
      ),
      true,
    );
    assert.equal(
      payload.backups.some(
        (backup) => backup.resourceId === fixtureIds.secondaryPostgres,
      ),
      true,
    );
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture exposes only non-secret Resource connection metadata", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/v1/core/resources/${fixtureIds.resource}`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(
      payload.resource.config.container.networkAlias,
      "primary-postgres",
    );
    assert.equal(payload.resource.config.access.sshTunnel.hostPort, 15_432);
    assert.deepEqual(payload.resource.serverSsh, {
      port: 22,
      username: "ubuntu",
    });
    assert.equal(JSON.stringify(payload).includes("privateKey"), false);
    assert.equal(JSON.stringify(payload).includes("secrets.login"), false);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture covers runtime controls and log capture", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (const [action, type] of [
      ["start", "start"],
      ["restart", "restart"],
      ["stop", "stop"],
      ["logs", "capture_logs"],
    ]) {
      const response = await fetch(
        `${baseUrl}/v1/core/apps/${fixtureIds.app}/actions/${action}`,
        {
          headers: { "idempotency-key": crypto.randomUUID() },
          method: "POST",
        },
      );
      assert.equal(response.status, 202, action);
      const payload = await response.json();
      assert.equal(payload.operation.type, type, action);
    }

    const operationsResponse = await fetch(
      `${baseUrl}/v1/core/apps/${fixtureIds.app}/operations`,
    );
    const operationsPayload = await operationsResponse.json();
    assert.equal(operationsPayload.operations[0].type, "capture_logs");
    assert.match(operationsPayload.operations[0].result.logs, /Health check/u);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture paginates server checks newest first", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/checks?page=2&limit=1`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.pagination, {
      limit: 1,
      page: 2,
      total: 2,
      totalPages: 2,
    });
    assert.equal(payload.checks.length, 1);
    assert.notEqual(payload.checks[0].id, payload.latestCheck.id);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture covers first-connection host-key trust", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const checksResponse = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/checks`,
    );
    const checksPayload = await checksResponse.json();
    const untrustedCheck = checksPayload.checks.find(
      (check) => check.errorCode === "HOST_KEY_NOT_TRUSTED",
    );
    assert.equal(
      untrustedCheck.result.discoveredHostKeys[0].fingerprint,
      "SHA256:TowbarFixtureHostKey",
    );

    const trustResponse = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/host-keys/actions/trust`,
      { method: "POST" },
    );
    assert.equal(trustResponse.status, 201);

    const keysResponse = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/host-keys`,
    );
    const keysPayload = await keysResponse.json();
    assert.equal(
      keysPayload.hostKeys[0].fingerprint,
      "SHA256:TowbarFixtureHostKey",
    );

    const revokeResponse = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/host-keys/${keysPayload.hostKeys[0].id}`,
      { method: "DELETE" },
    );
    assert.equal(revokeResponse.status, 204);

    const revokedKeysResponse = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/host-keys`,
    );
    const revokedKeysPayload = await revokedKeysResponse.json();
    assert.deepEqual(revokedKeysPayload.hostKeys, []);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("the local fixture covers server preparation and deployable readiness", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/host-keys/actions/trust`,
      { method: "POST" },
    );
    const response = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}/actions/prepare`,
      { method: "POST" },
    );
    assert.equal(response.status, 202);
    const payload = await response.json();
    assert.equal(payload.preparation.status, "succeeded");
    assert.equal(payload.preparation.steps.length, 7);

    const serverResponse = await fetch(
      `${baseUrl}/v1/core/servers/${fixtureIds.server}`,
    );
    const serverPayload = await serverResponse.json();
    assert.equal(serverPayload.server.setupStatus, "ready");

    const resourceResponse = await fetch(
      `${baseUrl}/v1/core/resources/${fixtureIds.resource}`,
    );
    const resourcePayload = await resourceResponse.json();
    assert.equal(resourcePayload.resource.serverReady, true);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("deployment history paginates all apps, resources, and environments in stable newest-first order", async () => {
  const fixture = createFixtureApiServer();
  fixture.listen(0, "127.0.0.1");
  await once(fixture, "listening");
  const baseUrl = `http://127.0.0.1:${fixture.address().port}`;
  async function readPage(page) {
    const response = await fetch(
      `${baseUrl}/v1/core/deployments/history?page=${page}&limit=10`,
    );
    assert.equal(response.status, 200);
    return response.json();
  }
  try {
    const first = await readPage(1);
    assert.equal(first.deployments.length, 10);
    assert.equal(first.pagination.page, 1);
    assert.equal(first.pagination.limit, 10);
    assert(first.pagination.totalPages > 1);
    const items = [...first.deployments];
    for (let page = 2; page <= first.pagination.totalPages; page++) {
      const next = await readPage(page);
      assert.equal(next.pagination.page, page);
      assert(next.deployments.length <= 10);
      items.push(...next.deployments);
    }
    assert.equal(items.length, first.pagination.total);
    assert.equal(new Set(items.map((item) => item.id)).size, items.length);
    assert(items.some((item) => item.deployableKind === "app"));
    assert(items.some((item) => item.deployableKind !== "app"));
    assert(items.some((item) => item.environment === "preview"));
    assert(items.some((item) => item.environment === "production"));
    assert(
      items.every(
        (item) =>
          item.deployableName && item.deployableName !== "Unknown workload",
      ),
    );
    assert.deepEqual(
      items.map((item) => item.id),
      [...items]
        .sort(
          (left, right) =>
            right.createdAt.localeCompare(left.createdAt) ||
            right.id.localeCompare(left.id),
        )
        .map((item) => item.id),
    );
    assert.deepEqual(
      (await readPage(first.pagination.totalPages + 1)).deployments,
      [],
    );
    const operational = await (
      await fetch(`${baseUrl}/v1/core/deployments`)
    ).json();
    assert(
      operational.deployments.every(
        (item) => item.environment === "production",
      ),
    );
  } finally {
    fixture.close();
    await once(fixture, "close");
  }
});

test("fixture Sources have distinct inventories and working scoped routes", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    const { sources } = await (
      await fetch(`${baseUrl}/v1/core/sources`)
    ).json();
    assert.equal(sources.length, 4);
    const expected = new Map([
      [fixtureIds.source, [3, 4, 2]],
      [fixtureIds.docsSource, [1, 0, 1]],
      [fixtureIds.analyticsSource, [0, 1, 1]],
      [fixtureIds.sandboxSource, [0, 0, 0]],
    ]);
    for (const source of sources) {
      const path = `${baseUrl}/v1/core/sources/${source.id}`;
      for (const child of [
        "",
        "/manifest",
        "/syncs",
        "/capacity",
        "/deployments",
      ]) {
        assert.equal((await fetch(path + child)).status, 200, path + child);
      }
      const { apps } = await (await fetch(`${path}/apps`)).json();
      const { resources } = await (await fetch(`${path}/resources`)).json();
      assert(
        [...apps, ...resources].every((item) => item.sourceId === source.id),
      );
      assert.deepEqual(
        [
          apps.length,
          resources.length,
          new Set([...apps, ...resources].map((item) => item.serverIp)).size,
        ],
        expected.get(source.id),
      );
    }
  } finally {
    server.close();
    await once(server, "close");
  }
});
