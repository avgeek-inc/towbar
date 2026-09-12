import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import * as schema from "../../packages/towbar-database/dist/schema/index.js";
const require = createRequire(
  new URL("../../apps/towbar-api/package.json", import.meta.url),
);
const { eq, inArray } = require("drizzle-orm");

export async function createResourceLifecycleDatabase({
  server,
  trustedHostKeys,
  key,
  entityType = "resource",
}) {
  const url = process.env.TOWBAR_TEST_DATABASE_URL;
  assert(
    url && new URL(url).pathname.endsWith("_test"),
    "Use a dedicated TOWBAR_TEST_DATABASE_URL ending in _test",
  );
  process.env.DATABASE_TOWBAR_URL = url;
  if (process.env.TOWBAR_TEST_TEMPORAL_ADDRESS) {
    assert(
      /^(127\.0\.0\.1|localhost):\d+$/.test(
        process.env.TOWBAR_TEST_TEMPORAL_ADDRESS,
      ),
    );
    process.env.TEMPORAL_ADDRESS = process.env.TOWBAR_TEST_TEMPORAL_ADDRESS;
    process.env.TEMPORAL_NAMESPACE = `resource-lifecycle-${randomUUID()}`;
    delete process.env.TEMPORAL_API_KEY;
  }
  process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
  process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
  const { runTowbarMigrations } =
    await import("../../packages/towbar-database/dist/migrate.js");
  await runTowbarMigrations({
    databaseUrl: url,
    logger: { info() {}, error() {} },
  });
  const { getTowbarDatabase, closeDatabase } =
    await import("../../apps/towbar-api/dist/infrastructure/database.js");
  const { mutateSecret } =
    await import("../../apps/towbar-api/dist/areas/secrets/store.js");
  const {
    getDeploymentExecutionContext,
    resolveDeploymentSecrets,
    commitDeploymentRelease,
  } = await import("../../apps/towbar-api/dist/areas/deployments/service.js");
  const { recordDeploymentEvent } =
    await import("../../apps/towbar-api/dist/areas/deployments/deployment-events.js");
  const db = getTowbarDatabase();
  const workspaceId = randomUUID(),
    userId = randomUUID(),
    sourceId = randomUUID(),
    serverId = randomUUID();
  const instances = new Map();
  const close = async () => {
    try {
      const ids = [...instances.values()].map((item) => item.id);
      if (ids.length)
        await db
          .delete(schema.releases)
          .where(inArray(schema.releases.appId, ids));
      await db
        .delete(schema.deployments)
        .where(eq(schema.deployments.workspaceId, workspaceId));
      await db
        .delete(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId));
      await db.delete(schema.users).where(eq(schema.users.id, userId));
    } finally {
      await closeDatabase();
    }
  };
  try {
    await db.insert(schema.workspaces).values({
      id: workspaceId,
      slug: workspaceId,
      name: "V2 lifecycle test",
    });
    await db.insert(schema.users).values({
      id: userId,
      email: `${userId}@example.com`,
      displayName: "Test",
    });
    const [installation] = await db
      .insert(schema.githubInstallations)
      .values({
        workspaceId,
        installationId: randomUUID(),
        accountLogin: "test",
        accountType: "Organization",
      })
      .returning();
    await db.insert(schema.sources).values({
      id: sourceId,
      workspaceId,
      githubInstallationId: installation.id,
      repositoryOwner: "test",
      repositoryName: "test",
    });
    await db.insert(schema.servers).values({
      id: serverId,
      workspaceId,
      slug: "test",
      canonicalIp: server.ip,
      config: server,
      configDigest: "test",
      preparedConfigDigest: "test",
      setupStatus: "ready",
      preparedAt: new Date(),
    });
    await db.insert(schema.sshHostKeys).values(
      trustedHostKeys.map((item) => ({
        ...item,
        serverId,
        trustedBy: userId,
      })),
    );
    await mutateSecret(
      {
        type: "server",
        id: serverId,
        workspaceId,
        environment: "production",
        stage: "credentials",
      },
      {
        expectedRevision: null,
        set: { privateKey: readFileSync(key, "utf8") },
        delete: [],
      },
      userId,
    );
    const [entity] = await db
      .insert(schema.sourceEntities)
      .values({
        sourceId,
        manifestId: entityType === "app" ? "website" : "database",
        entityType,
      })
      .returning();
    for (const name of ["production", "staging"]) {
      const [environment] = await db
        .insert(schema.sourceEnvironments)
        .values({
          sourceId,
          name,
          branch: name === "production" ? "main" : "develop",
        })
        .returning();
      const [sync] = await db
        .insert(schema.sourceSyncs)
        .values({
          sourceId,
          sourceEnvironmentId: environment.id,
          mappingRevision: environment.mappingRevision,
          status: "succeeded",
          commitSha: "c".repeat(40),
          manifestDigest: "test",
        })
        .returning();
      await db
        .update(schema.sourceEnvironments)
        .set({
          latestSuccessfulSyncId: sync.id,
          latestCommitSha: "c".repeat(40),
          latestManifestDigest: "test",
        })
        .where(eq(schema.sourceEnvironments.id, environment.id));
      instances.set(name, {
        id: randomUUID(),
        environment: { ...environment, latestSuccessfulSyncId: sync.id },
        entityId: entity.id,
        seeded: false,
      });
    }
    return {
      close,
      previewContext: {
        db,
        schema,
        instances,
        sourceId,
        workspaceId,
        userId,
        mutateSecret,
      },
      async prepare(name, app, resolve = true, commitSha = "c".repeat(40)) {
        const instance = instances.get(name);
        const requiredSecrets = {
          build: entityType === "app" ? ["BUILD_MARKER"] : [],
          runtime: [entityType === "app" ? "ENV_MARKER" : "REDIS_PASSWORD"],
          preDeploy: [],
          postDeploy: [],
        };
        if (!instance.seeded) {
          await db.insert(schema.apps).values({
            id: instance.id,
            workspaceId,
            sourceId,
            serverId,
            entityId: instance.entityId,
            sourceEnvironmentId: instance.environment.id,
            manifestId: app.id,
            name: app.name,
            kind: app.kind,
            config: app,
            configDigest: "test",
            deploymentDigest: "test",
            sourceRevision: "c".repeat(40),
            requiredSecrets,
          });
          instance.seeded = true;
          await mutateSecret(
            {
              type: "app",
              id: instance.id,
              workspaceId,
              environment: name,
              stage: "deployment",
            },
            {
              expectedRevision: null,
              set:
                entityType === "app"
                  ? { ENV_MARKER: name }
                  : { REDIS_PASSWORD: `test-${name}` },
              delete: [],
            },
            userId,
          );
        }
        if (entityType === "app") {
          await db
            .update(schema.sourceEnvironments)
            .set({ latestCommitSha: commitSha })
            .where(eq(schema.sourceEnvironments.id, instance.environment.id));
          await db
            .update(schema.sourceSyncs)
            .set({ commitSha })
            .where(
              eq(
                schema.sourceSyncs.id,
                instance.environment.latestSuccessfulSyncId,
              ),
            );
          if (!instance.buildSecretStored) {
            await mutateSecret(
              {
                type: "app",
                id: instance.id,
                workspaceId,
                environment: name,
                stage: "build",
              },
              {
                expectedRevision: null,
                set: { BUILD_MARKER: "test-build-value" },
                delete: [],
              },
              userId,
            );
            instance.buildSecretStored = true;
          }
        }
        if (!resolve) {
          await db
            .update(schema.apps)
            .set({ config: app, sourceRevision: commitSha })
            .where(eq(schema.apps.id, instance.id));
          const { requestAppDeployment } =
            await import("../../apps/towbar-api/dist/areas/apps/service.js");
          const request = {
            appId: instance.id,
            workspaceId,
            requestedBy: userId,
            expectedType: entityType,
            idempotencyKey: randomUUID(),
          };
          const result = await requestAppDeployment(request);
          const replay = await requestAppDeployment(request);
          assert.equal(replay.deployment.id, result.deployment.id);
          assert.equal(replay.replayed, true);
          return { deploymentId: result.deployment.id };
        }
        const deploymentId = randomUUID();
        const { id, branch, mappingRevision } = instance.environment;
        await db.insert(schema.deployments).values({
          id: deploymentId,
          workspaceId,
          sourceId,
          appId: instance.id,
          serverId,
          targetEnvironment: { id, name, branch, mappingRevision },
          requiredSecrets,
          idempotencyKey: deploymentId,
          temporalWorkflowId: deploymentId,
          commitSha: "c".repeat(40),
          manifestDigest: "test",
          deploymentDigest: "test",
          appSnapshot: app,
          serverSnapshot: server,
          deployableKind: "redis",
        });
        await recordDeploymentEvent(deploymentId, {
          state: "waiting_for_server",
        });
        return {
          context: await getDeploymentExecutionContext(deploymentId),
          secrets: await resolveDeploymentSecrets(deploymentId),
          hooks: {
            transition: async (state, message) => {
              console.log(`${name}: ${state}`);
              await recordDeploymentEvent(deploymentId, { state, message });
            },
            commitRelease: (result) =>
              commitDeploymentRelease(deploymentId, result),
          },
        };
      },
      async result(deploymentId) {
        const [release] = await db
          .select()
          .from(schema.releases)
          .where(eq(schema.releases.deploymentId, deploymentId));
        assert(release, "Successful workflow must commit a release");
        return release;
      },
      async verify(runningInstances, failureState = "checking_health") {
        const rows = await db
          .select()
          .from(schema.releases)
          .where(
            inArray(
              schema.releases.appId,
              [...instances.values()].map((item) => item.id),
            ),
          );
        assert.equal(
          rows.filter((item) => item.status === "current").length,
          2,
        );
        assert.equal(
          rows.filter((item) => item.status === "previous").length,
          1,
        );
        for (const [name, instance] of instances) {
          const current = rows.filter(
            (row) => row.appId === instance.id && row.status === "current",
          );
          assert.equal(current.length, 1);
          assert.equal(
            current[0].containerName,
            runningInstances.get(name).current.containerName,
          );
        }
        const deployments = await db
          .select()
          .from(schema.deployments)
          .where(eq(schema.deployments.workspaceId, workspaceId));
        assert.equal(deployments.length, 4);
        const failedCandidate = deployments.filter(
          (item) => item.state !== "succeeded",
        );
        assert.equal(failedCandidate.length, 1);
        assert.equal(failedCandidate[0].state, failureState);
        assert(!rows.some((row) => row.deploymentId === failedCandidate[0].id));
        assert.equal(
          deployments.filter((item) => item.state === "succeeded").length,
          3,
        );
        assert(
          deployments
            .filter((item) => item.state === "succeeded")
            .every((item) => item.secretRevisions),
        );
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
