import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
let database;
let temporal;
try {
  const server = normalizeServerConfiguration({
    ip: "127.0.0.1",
    ssh: { username: "deploy", port: target.port },
  });
  const trustedHostKeys = await scanHostKeys(server);
  if (process.env.TOWBAR_TEST_DATABASE_URL) {
    const { createResourceLifecycleDatabase } =
      await import("./resource-database.mjs");
    database = await createResourceLifecycleDatabase({
      server,
      trustedHostKeys,
      key: target.key,
    });
  }
  if (process.env.TOWBAR_TEST_TEMPORAL_ADDRESS) {
    assert(database, "Temporal mode requires TOWBAR_TEST_DATABASE_URL");
    const { startResourceTemporal } = await import("./resource-temporal.mjs");
    temporal = await startResourceTemporal();
  }
  const sourceId = randomUUID();
  const instances = new Map(
    ["production", "staging"].map((name) => [
      name,
      { id: randomUUID(), current: null },
    ]),
  );
  const deploy = async (name, failHealth = false) => {
    const instance = instances.get(name);
    const app = normalizeDeploymentManifest({
      version: 2,
      apps: [],
      resources: [
        {
          id: "database",
          name: "Database",
          type: "redis",
          server: "test",
          container: { network: `e2e-${name}`, networkAlias: "database" },
        },
      ],
    }).resources[0];
    if (failHealth)
      app.health = { type: "command", command: ["false"], timeoutSeconds: 2 };
    const previous = instance.current;
    const execution = database
      ? await database.prepare(name, app, !temporal)
      : {
          context: {
            app,
            server,
            trustedHostKeys,
            sourceId,
            deployableId: instance.id,
            deploymentId: randomUUID(),
            commitSha: "c".repeat(40),
            environment: "production",
            kind: "deploy",
            githubToken: null,
            repositoryName: "test",
            repositoryOwner: "test",
            rollbackRelease: null,
            currentRelease: previous,
          },
          secrets: {
            build: {},
            runtime: { REDIS_PASSWORD: `test-${name}` },
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
        };
    const result = temporal
      ? (await temporal.execute(execution.deploymentId),
        await database.result(execution.deploymentId))
      : await executeDeployment(execution);
    instance.current = result;
    return result;
  };
  const redis = (name, command) => {
    const instance = instances.get(name);
    return target.ssh(
      `docker exec ${instance.current.containerName} redis-cli --no-auth-warning -a test-${name} ${command}`,
    );
  };
  await deploy("production");
  await deploy("staging");
  assert.equal(redis("production", "SET environment production-data"), "OK");
  assert.equal(redis("staging", "SET environment staging-data"), "OK");
  const originalProduction = instances.get("production").current.containerName;
  const oldStaging = instances.get("staging").current.containerName;
  await deploy("staging");
  assert.equal(redis("production", "GET environment"), "production-data");
  assert.equal(redis("staging", "GET environment"), "staging-data");
  assert.equal(
    instances.get("production").current.containerName,
    originalProduction,
  );
  assert.notEqual(instances.get("staging").current.containerName, oldStaging);
  assert.equal(
    target.ssh(
      `docker ps -a --filter name=^/${oldStaging}$ --format '{{.Names}}'`,
    ),
    "",
  );
  const retainedStaging = instances.get("staging").current.containerName;
  await assert.rejects(deploy("staging", true));
  assert.equal(instances.get("staging").current.containerName, retainedStaging);
  assert.equal(redis("staging", "GET environment"), "staging-data");
  assert.equal(redis("production", "GET environment"), "production-data");
  const running = target
    .ssh("docker ps --format '{{.Names}}'")
    .split("\n")
    .sort();
  assert.deepEqual(running, [originalProduction, retainedStaging].sort());
  if (database)
    await database.verify(instances, temporal ? "failed" : "checking_health");
  if (temporal) await temporal.verify();
  console.log(
    "Production/staging data isolation, redeployment, failed-health recovery and candidate cleanup verified.",
  );
} finally {
  try {
    try {
      if (temporal) await temporal.close();
    } finally {
      if (database) await database.close();
    }
  } finally {
    target.close();
  }
}
