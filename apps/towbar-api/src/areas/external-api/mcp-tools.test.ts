import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
process.env.DATABASE_TOWBAR_URL ??= "postgres://test:test@localhost/mcp_test";
process.env.TOWBAR_CREDENTIALS_KEY ??= Buffer.alloc(32, 1).toString("base64");
process.env.TOWBAR_INTERNAL_HMAC_SECRET ??=
  "mcp-contract-test-only-placeholder-secret";
const { mcpTools } = await import("./mcp-tools.js");
const { operations } = await import("./catalogue.js");
const uuid = "31111111-1111-4111-8111-222222222222";
const otherUuid = "41111111-1111-4111-8111-222222222222";
function get(name: string) {
  const tool = mcpTools.find((t) => t.name === `towbar_${name}`);
  assert(tool);
  return tool;
}
function harness(responses: Record<string, Record<string, unknown>> = {}) {
  const calls: import("./mcp-tools.js").OperationCall[] = [];
  return {
    calls,
    context: {
      call: (request: import("./mcp-tools.js").OperationCall) => {
        const op = operations.find(
          (op) => op.path === request.route && op.method === request.method,
        );
        assert(
          op,
          `${request.method} ${request.route} is not a public operation`,
        );
        const { route: _route, method: _method, ...input } = request;
        if (input.path && !Object.keys(input.path).length) delete input.path;
        op.input.parse(input); // Includes refinements shared with the actual handler.
        calls.push(request);
        return Promise.resolve(
          responses[`${request.method} ${request.route}`] ?? {},
        );
      },
    },
  };
}
void test("MCP catalogue is curated, namespaced, directly typed, and independent of REST IDs", () => {
  assert(mcpTools.length <= 55);
  assert(mcpTools.length < operations.length);
  assert.equal(new Set(mcpTools.map((t) => t.name)).size, mcpTools.length);
  for (const tool of mcpTools) {
    assert.match(tool.name, /^towbar_[a-z]+_[a-z_]+$/);
    assert(tool.name.length <= 64);
    assert(tool.title && tool.description.length > 50);
    assert(!operations.some((op) => op.name === tool.name));
    const schema = z.toJSONSchema(tool.input, {
      io: "input",
      unrepresentable: "any",
    });
    assert.equal(schema.type, "object");
    for (const field of ["path", "query", "body", "method", "url", "route"])
      assert(!Object.hasOwn(schema.properties ?? {}, field));
    if (tool.readOnly) {
      assert(!tool.destructive);
      assert(tool.idempotent);
    }
  }
  const secrets = z.toJSONSchema(get("secrets_update").input, { io: "input" });
  assert.equal((secrets.properties!.set as { type: string }).type, "object");
});
void test("find an app by name, then deploy exactly that ID with the retry key", async () => {
  const h = harness({
    "GET /apps": {
      apps: [
        { id: uuid, name: "Website", config: { large: "omit" } },
        { id: otherUuid, name: "Admin" },
      ],
    },
    "POST /apps/:appId/actions/deploy": {
      deployment: { id: otherUuid, state: "queued" },
      accepted: true,
    },
  });
  const found = await get("inventory_search").run(
    { kind: "app", search: "website", limit: 1 },
    h.context,
  );
  assert.deepEqual(found, {
    kind: "app",
    items: [{ id: uuid, name: "Website" }],
    total: 1,
    nextOffset: null,
  });
  const accepted = await get("workload_deploy").run(
    { kind: "app", workloadId: uuid, idempotencyKey: "release-one" },
    h.context,
  );
  assert.equal(accepted.accepted, true);
  assert.deepEqual(h.calls.at(-1), {
    method: "POST",
    route: "/apps/:appId/actions/deploy",
    path: { appId: uuid },
    idempotencyKey: "release-one",
  });
  await assert.rejects(
    () =>
      get("workload_deploy").run({ kind: "app", workloadId: uuid }, h.context),
    z.ZodError,
  );
});
void test("deployment diagnosis combines state, steps and incremental logs without treating acceptance as success", async () => {
  const h = harness({
    "GET /deployments/:deploymentId/events": {
      deployment: { id: uuid, state: "building" },
      steps: [{ state: "running" }],
      logs: [
        { sequence: 1, content: "one" },
        { sequence: 2, content: "two" },
      ],
    },
  });
  const result = await get("deployment_inspect").run(
    { deploymentId: uuid, logLimit: 1 },
    h.context,
  );
  assert.equal(result.terminal, false);
  assert.equal(result.hasMoreLogs, true);
  assert.equal(result.nextAfter, 1);
  assert.deepEqual(result.logs, [{ sequence: 1, content: "one" }]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0]!.query!.snapshot, "true");
  const done = harness({
    "GET /deployments/:deploymentId/events": {
      deployment: { state: "failed" },
      steps: [],
      logs: [],
    },
  });
  const terminal = await get("deployment_inspect").run(
    { deploymentId: uuid, after: 1 },
    done.context,
  );
  assert.equal(terminal.terminal, true);
  assert.equal(terminal.nextAfter, 1);
});
void test("workload inspection combines configuration, releases and runtime operations for both workload types", async () => {
  for (const kind of ["app", "resource"] as const) {
    const h = harness();
    await get("workload_inspect").run({ kind, workloadId: uuid }, h.context);
    assert.equal(h.calls.length, 5);
    assert(
      h.calls.every(
        (call) => call.method === "GET" && call.path![`${kind}Id`] === uuid,
      ),
    );
    for (const intent of [
      "deploy",
      "rollback",
      "restart",
      "start",
      "stop",
      "logs",
    ]) {
      await get(`workload_${intent}`).run(
        { kind, workloadId: uuid, idempotencyKey: `${intent}-one` },
        h.context,
      );
      assert.equal(
        h.calls.at(-1)!.route,
        `/${kind}s/:${kind}Id/actions/${intent}`,
      );
    }
  }
});
void test("secret scopes are explicit and revision/conflicting-key checks are preserved", async () => {
  for (const scope of ["workspace", "source", "app", "resource"] as const) {
    const h = harness();
    const target = scope === "workspace" ? {} : { targetId: uuid };
    await get("secrets_inspect").run({ scope, ...target }, h.context);
    await get("secrets_update").run(
      {
        scope,
        ...target,
        environment: "preview",
        stage: "build",
        expectedRevision: null,
        set: { TOKEN: "value" },
      },
      h.context,
    );
    assert.equal(h.calls.at(-1)!.method, "PATCH");
    await assert.rejects(
      () =>
        get("secrets_update").run(
          {
            scope,
            ...target,
            environment: "preview",
            stage: "build",
            expectedRevision: null,
            set: { TOKEN: "value" },
            delete: ["TOKEN"],
          },
          h.context,
        ),
      z.ZodError,
    );
  }
  for (const args of [{ scope: "workspace", targetId: uuid }, { scope: "app" }])
    await assert.rejects(
      () => get("secrets_inspect").run(args, harness().context),
      z.ZodError,
    );
});
void test("source tools use v2 discovery, branch mappings and environment sync routes", async () => {
  const h = harness();
  const repository = {
    githubInstallationId: uuid,
    repositoryOwner: "example",
    repositoryName: "app",
  };
  await get("source_discover").run(
    { ...repository, discoveryBranch: "main" },
    h.context,
  );
  assert.equal(h.calls.at(-1)!.route, "/sources/discover");
  await get("source_connect").run(
    {
      ...repository,
      environments: [
        { environment: "production", branch: "main" },
        { environment: "staging", branch: "develop" },
      ],
    },
    h.context,
  );
  assert.equal(h.calls.at(-1)!.route, "/sources/connect");
  await get("source_sync").run({ sourceId: uuid }, h.context);
  assert.equal(h.calls.at(-1)!.route, "/sources/:sourceId/environments/syncs");
  await get("source_sync").run(
    { sourceId: uuid, environmentId: otherUuid },
    h.context,
  );
  assert.equal(
    h.calls.at(-1)!.route,
    "/sources/:sourceId/environments/:environmentId/syncs",
  );
  assert.deepEqual(h.calls.at(-1)!.path, {
    sourceId: uuid,
    environmentId: otherUuid,
  });
  assert(
    !operations.some((op) => op.path === "/sources/:sourceId/actions/sync"),
  );
  assert(
    !operations.some((op) => op.path === "/sources" && op.method === "POST"),
  );
});
void test("server inspection, scoped inventories and previews use valid bounded read recipes", async () => {
  const h = harness();
  await get("server_inspect").run({ serverId: uuid }, h.context);
  assert.equal(h.calls.length, 8);
  for (const kind of ["app", "resource"]) {
    await get("inventory_search").run({ kind, sourceId: uuid }, h.context);
    await get("inventory_search").run({ kind, serverId: uuid }, h.context);
  }
  for (const scope of ["source", "app"])
    await get("preview_list").run({ scope, targetId: uuid }, h.context);
  await get("source_inspect").run({ sourceId: uuid }, h.context);
  await get("source_sync_inspect").run(
    { sourceId: uuid, syncId: otherUuid },
    h.context,
  );
  await get("source_sync_inspect").run({ sourceId: uuid }, h.context);
  await get("backup_inspect").run(
    { scope: "source", targetId: uuid },
    h.context,
  );
  await get("backup_inspect").run(
    { scope: "resource", targetId: uuid, operationId: otherUuid },
    h.context,
  );
  assert(h.calls.every((call) => call.method === "GET"));
  await assert.rejects(
    () =>
      get("inventory_search").run(
        { kind: "source", sourceId: uuid },
        h.context,
      ),
    z.ZodError,
  );
});

void test("monitoring requires installation acknowledgement and preserves preview scoping", async () => {
  const h = harness();
  await assert.rejects(
    get("monitoring_configure").run(
      { serverId: uuid, action: "install", retentionDays: 15 },
      h.context,
    ),
  );
  await get("monitoring_configure").run(
    { serverId: uuid, action: "install", retentionDays: 15, acknowledge: true },
    h.context,
  );
  assert.deepEqual(h.calls[0]?.body, { retentionDays: 15, acknowledge: true });
  await get("performance_inspect").run(
    {
      kind: "app",
      targetId: uuid,
      range: "7d",
      environment: "preview",
      previewId: otherUuid,
    },
    h.context,
  );
  assert.equal(h.calls[1]?.route, "/apps/:appId/metrics");
  assert.equal(h.calls[1]?.query?.previewId, otherUuid);
  assert(get("monitoring_configure").ownerOnly);
});

void test("Scout tools inspect before mutation and keep comparison output bounded", async () => {
  const h = harness({
    "GET /servers/:serverId/scout-alerts": { rules: [{ id: otherUuid }] },
    "GET /servers/:serverId/scout-alerts/incidents": { incidents: [] },
  });
  const result = await get("alerts_inspect").run({ serverId: uuid }, h.context);
  assert.deepEqual(result.rules, [{ id: otherUuid }]);
  await get("alerts_mute").run(
    {
      serverId: uuid,
      ruleId: otherUuid,
      durationSeconds: 1800,
      reason: "Maintenance",
    },
    h.context,
  );
  assert.equal(
    h.calls.at(-1)?.route,
    "/servers/:serverId/scout-alerts/rules/:ruleId/mute",
  );
  await get("deployment_compare").run({ workloadId: uuid }, h.context);
  assert.equal(
    h.calls.at(-1)?.route,
    "/workloads/:deployableId/comparison-deployments",
  );
  const points = Array.from({ length: 240 }, (_, offsetSeconds) => ({
    offsetSeconds,
    metrics: {},
  }));
  const compare = harness({
    "GET /workloads/:deployableId/deployment-comparison": {
      baseline: { points },
      candidate: { points },
      metrics: [],
    },
  });
  const summary = await get("deployment_compare").run(
    { workloadId: uuid, baselineId: uuid, candidateId: otherUuid },
    compare.context,
  );
  assert(!Object.hasOwn(summary.baseline as object, "points"));
  const detailed = await get("deployment_compare").run(
    {
      workloadId: uuid,
      baselineId: uuid,
      candidateId: otherUuid,
      includePoints: true,
    },
    compare.context,
  );
  assert((detailed.baseline as { points: unknown[] }).points.length <= 24);
  assert(
    get("alerts_configure").ownerOnly && !get("alerts_configure").readOnly,
  );
});
