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
  "/v1/core/github/repositories",
  "/v1/core/sources",
  "/v1/core/apps",
  "/v1/core/resources",
  "/v1/core/servers",
  "/v1/core/deployments",
  `/v1/core/sources/${fixtureIds.source}`,
  `/v1/core/sources/${fixtureIds.source}/manifest`,
  `/v1/core/sources/${fixtureIds.source}/syncs`,
  `/v1/core/sources/${fixtureIds.source}/aws`,
  `/v1/core/sources/${fixtureIds.source}/secrets`,
  `/v1/core/sources/${fixtureIds.source}/apps`,
  `/v1/core/sources/${fixtureIds.source}/resources`,
  `/v1/core/sources/${fixtureIds.source}/servers`,
  `/v1/core/sources/${fixtureIds.source}/deployments`,
  `/v1/core/sources/${fixtureIds.source}/backups`,
  `/v1/core/sources/${fixtureIds.source}/syncs/${fixtureIds.sync}`,
  `/v1/core/apps/${fixtureIds.app}`,
  `/v1/core/apps/${fixtureIds.app}/secrets`,
  `/v1/core/apps/${fixtureIds.app}/deployments`,
  `/v1/core/apps/${fixtureIds.app}/releases`,
  `/v1/core/apps/${fixtureIds.app}/operations`,
  `/v1/core/resources/${fixtureIds.resource}`,
  `/v1/core/resources/${fixtureIds.resource}/secrets`,
  `/v1/core/resources/${fixtureIds.resource}/deployments`,
  `/v1/core/resources/${fixtureIds.resource}/releases`,
  `/v1/core/resources/${fixtureIds.resource}/operations`,
  `/v1/core/servers/${fixtureIds.server}`,
  `/v1/core/servers/${fixtureIds.server}/apps`,
  `/v1/core/servers/${fixtureIds.server}/resources`,
  `/v1/core/servers/${fixtureIds.server}/deployments`,
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

test("the local fixture exposes secret keys without values and supports versioned key edits", async () => {
  const server = createFixtureApiServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const initialResponse = await fetch(
      `${baseUrl}/v1/core/apps/${fixtureIds.app}/secrets`,
    );
    assert.equal(initialResponse.status, 200);
    const initial = await initialResponse.json();
    assert.equal(initial.canManageSecrets, true);
    assert.equal(
      initial.bindings.every((candidate) =>
        candidate.uses.every((use) => use.scope === "app"),
      ),
      true,
    );
    const binding = initial.bindings.find((candidate) =>
      candidate.reference.endsWith("/deployment"),
    );
    assert(binding?.versionId);
    assert.equal(
      JSON.stringify(initial).includes("fixture-secret-value"),
      false,
    );

    const resourceSecretsResponse = await fetch(
      `${baseUrl}/v1/core/resources/${fixtureIds.resource}/secrets`,
    );
    assert.equal(resourceSecretsResponse.status, 200);
    const resourceSecrets = await resourceSecretsResponse.json();
    assert.equal(resourceSecrets.bindings.length, 1);
    const resourceBinding = resourceSecrets.bindings[0];
    assert.deepEqual(resourceBinding.uses, [
      { scope: "app", stage: "deployment" },
    ]);
    assert.equal(resourceBinding.keys.includes("POSTGRES_PASSWORD"), true);
    assert.equal(
      JSON.stringify(resourceSecrets).includes("fixture-postgres_password"),
      false,
    );

    const revealResponse = await fetch(
      `${baseUrl}/v1/core/apps/${fixtureIds.app}/secrets/reveal`,
      {
        body: JSON.stringify({ reference: binding.reference }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    assert.equal(revealResponse.status, 200);
    assert.match(revealResponse.headers.get("cache-control") ?? "", /no-store/);
    const revealed = await revealResponse.json();
    assert.equal(typeof revealed.secret.values.DATABASE_URL, "string");
    assert.equal(revealed.secret.versionId, binding.versionId);

    const resourceRevealResponse = await fetch(
      `${baseUrl}/v1/core/resources/${fixtureIds.resource}/secrets/reveal`,
      {
        body: JSON.stringify({ reference: resourceBinding.reference }),
        headers: { "content-type": "application/json" },
        method: "POST",
      },
    );
    assert.equal(resourceRevealResponse.status, 200);
    assert.match(
      resourceRevealResponse.headers.get("cache-control") ?? "",
      /no-store/,
    );
    const resourceRevealed = await resourceRevealResponse.json();
    assert.equal(
      typeof resourceRevealed.secret.values.POSTGRES_PASSWORD,
      "string",
    );

    const resourceUpdateResponse = await fetch(
      `${baseUrl}/v1/core/resources/${fixtureIds.resource}/secrets`,
      {
        body: JSON.stringify({
          delete: [],
          expectedVersionId: resourceBinding.versionId,
          reference: resourceBinding.reference,
          set: { POSTGRES_PASSWORD: "updated-resource-secret" },
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    assert.equal(resourceUpdateResponse.status, 200);
    const resourceUpdated = await resourceUpdateResponse.json();
    assert.equal(
      resourceUpdated.secret.keys.includes("POSTGRES_PASSWORD"),
      true,
    );
    assert.equal(
      JSON.stringify(resourceUpdated).includes("updated-resource-secret"),
      false,
    );

    const resourceDeployResponse = await fetch(
      `${baseUrl}/v1/core/resources/${fixtureIds.resource}/actions/deploy`,
      {
        headers: { "idempotency-key": crypto.randomUUID() },
        method: "POST",
      },
    );
    assert.equal(resourceDeployResponse.status, 202);
    const resourceDeployment = await resourceDeployResponse.json();
    assert.equal(resourceDeployment.deployment.appId, fixtureIds.resource);
    assert.equal(resourceDeployment.deployment.deployableKind, "postgres");

    const sourceSecretsResponse = await fetch(
      `${baseUrl}/v1/core/sources/${fixtureIds.source}/secrets`,
    );
    assert.equal(sourceSecretsResponse.status, 200);
    const sourceSecrets = await sourceSecretsResponse.json();
    assert.equal(
      sourceSecrets.bindings.every((candidate) =>
        candidate.uses.every((use) => use.scope === "shared"),
      ),
      true,
    );

    const updateResponse = await fetch(
      `${baseUrl}/v1/core/apps/${fixtureIds.app}/secrets`,
      {
        body: JSON.stringify({
          delete: ["DATABASE_URL"],
          expectedVersionId: binding.versionId,
          reference: binding.reference,
          set: { NEW_TOKEN: "fixture-secret-value" },
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    assert.equal(updateResponse.status, 200);
    const updated = await updateResponse.json();
    assert.equal(updated.secret.keys.includes("DATABASE_URL"), false);
    assert.equal(updated.secret.keys.includes("NEW_TOKEN"), true);
    assert.equal(
      JSON.stringify(updated).includes("fixture-secret-value"),
      false,
    );

    const staleResponse = await fetch(
      `${baseUrl}/v1/core/apps/${fixtureIds.app}/secrets`,
      {
        body: JSON.stringify({
          delete: [],
          expectedVersionId: binding.versionId,
          reference: binding.reference,
          set: { OTHER_TOKEN: "another-value" },
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    assert.equal(staleResponse.status, 409);

    const otherAppResponse = await fetch(
      `${baseUrl}/v1/core/apps/31111111-1111-4111-8111-111111111111/secrets`,
    );
    const otherApp = await otherAppResponse.json();
    const unattachedBinding = otherApp.bindings.find((candidate) =>
      candidate.reference.endsWith("/deployment"),
    );
    assert(unattachedBinding?.versionId);
    const unattachedResponse = await fetch(
      `${baseUrl}/v1/core/apps/${fixtureIds.app}/secrets`,
      {
        body: JSON.stringify({
          delete: [],
          expectedVersionId: unattachedBinding.versionId,
          reference: unattachedBinding.reference,
          set: { OTHER_TOKEN: "must-not-be-written" },
        }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      },
    );
    assert.equal(unattachedResponse.status, 404);
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
    assert.equal(payload.backups.length, 2);
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
    const sourceServersResponse = await fetch(
      `${baseUrl}/v1/core/sources/${fixtureIds.source}/servers`,
    );
    const sourceServersPayload = await sourceServersResponse.json();
    assert.equal(sourceServersPayload.servers[0].hostKeyStatus, "untrusted");
    assert.equal(sourceServersPayload.servers[1].hostKeyStatus, "trusted");

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

    const trustedSourceServersResponse = await fetch(
      `${baseUrl}/v1/core/sources/${fixtureIds.source}/servers`,
    );
    const trustedSourceServersPayload =
      await trustedSourceServersResponse.json();
    assert.equal(
      trustedSourceServersPayload.servers[0].hostKeyStatus,
      "trusted",
    );
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
