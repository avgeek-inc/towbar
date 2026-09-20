import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import {
  normalizeDeploymentManifest,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  deployments,
  serverChecks,
  servers,
  sourceEntities,
  sourceEnvironments,
  sources,
  users,
  workspaces,
} from "@workspace/towbar-database/schema";
import { seedEnvironmentTeam } from "../sources/environment-server-tests.js";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "app storage is workspace scoped, reports observed mounts and keeps server binding after removing YAML volumes",
  { skip: !url },
  async () => {
    assert(url && new URL(url).pathname.endsWith("_test"));
    process.env.DATABASE_TOWBAR_URL = url;
    process.env.TOWBAR_CREDENTIALS_KEY = randomBytes(32).toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl: url,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const { getAppStorage, assertAppStorageServer } =
      await import("./storage.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      userId = randomUUID(),
      sourceId = randomUUID(),
      appId = randomUUID();
    const serverId = randomUUID(),
      otherServer = randomUUID(),
      entityId = randomUUID(),
      environmentId = randomUUID();
    const config = normalizeDeploymentManifest({
      version: 2,
      source: { branch: "main" },
      apps: [
        {
          id: "files",
          name: "Files",
          server: "192.0.2.10",
          dockerfile: "Dockerfile",
          rollout: {
            type: "recreate",
            reason: "The app uses a single-writer managed volume",
            maintenanceMode: true,
          },
          container: {
            port: 3000,
            volumes: [{ name: "uploads", mountPath: "/data" }],
          },
        },
      ],
    }).apps[0]!;
    const server = normalizeServerConfiguration({
      ip: "192.0.2.10",
      ssh: { username: "root" },
    });
    const secrets = { build: [], runtime: [], preDeploy: [], postDeploy: [] };
    try {
      await seedEnvironmentTeam({ workspaceId, userId, sourceId });
      await db.insert(servers).values([
        {
          id: serverId,
          workspaceId,
          canonicalIp: server.ip,
          config: server,
          configDigest: "test",
        },
        {
          id: otherServer,
          workspaceId,
          canonicalIp: "192.0.2.11",
          config: { ...server, ip: "192.0.2.11" },
          configDigest: "test",
        },
      ]);
      await db.insert(sourceEnvironments).values({
        id: environmentId,
        sourceId,
        name: "production",
        branch: "main",
      });
      await db.insert(sourceEntities).values({
        id: entityId,
        sourceId,
        entityType: "app",
        manifestId: "files",
      });
      await db.insert(apps).values({
        id: appId,
        workspaceId,
        sourceId,
        serverId,
        entityId,
        sourceEnvironmentId: environmentId,
        manifestId: "files",
        name: "Files",
        config,
        configDigest: "test",
        sourceRevision: "a".repeat(40),
        requiredSecrets: secrets,
      });
      assert.equal(
        (await getAppStorage(appId, workspaceId)).volumes[0]!.status,
        "unknown",
      );
      await assert.rejects(getAppStorage(appId, randomUUID()), /not found/i);
      const observed = {
        deployableId: appId,
        runtimeId: appId,
        name: "uploads",
        volumeName: `towbar-${appId}-uploads`,
        mountPath: "/data",
        mounted: true,
      };
      await db.insert(serverChecks).values({
        serverId,
        status: "succeeded",
        finishedAt: new Date(),
        result: {
          storage: [
            observed,
            { ...observed, runtimeId: randomUUID(), name: "preview-secret" },
            { ...observed, deployableId: randomUUID(), name: "other-app" },
          ],
        },
      });
      assert.deepEqual(
        (await getAppStorage(appId, workspaceId)).volumes.map((volume) => [
          volume.name,
          volume.status,
        ]),
        [["uploads", "mounted"]],
      );
      await db.insert(deployments).values({
        workspaceId,
        sourceId,
        serverId,
        appId,
        idempotencyKey: randomUUID(),
        temporalWorkflowId: randomUUID(),
        commitSha: "a".repeat(40),
        manifestDigest: "b".repeat(64),
        requiredSecrets: secrets,
        appSnapshot: config,
        serverSnapshot: server,
        targetEnvironment: {
          id: environmentId,
          name: "production",
          branch: "main",
          mappingRevision: randomUUID(),
        },
      });
      await assertAppStorageServer(db, appId, serverId);
      await assert.rejects(
        assertAppStorageServer(db, appId, otherServer),
        /persistent storage on another server/,
      );
      await db
        .update(apps)
        .set({ config: { ...config, container: { port: 3000 } } })
        .where(eq(apps.id, appId));
      assert.equal(
        (await getAppStorage(appId, workspaceId)).volumes[0]!.status,
        "retained",
      );
      await assert.rejects(
        assertAppStorageServer(db, appId, otherServer),
        /persistent storage on another server/,
      );
    } finally {
      await db.delete(deployments).where(eq(deployments.appId, appId));
      await db.delete(apps).where(eq(apps.id, appId));
      await db.delete(sources).where(eq(sources.id, sourceId));
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
