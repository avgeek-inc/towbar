import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import {
  createServerPreparationSteps,
  normalizeServerConfiguration,
  serverPreparationStepLogMaxLength,
} from "@workspace/towbar-core";
import {
  serverPreparations,
  servers,
  users,
  workspaceMembers,
  workspaces,
} from "@workspace/towbar-database/schema";

const url = process.env.TOWBAR_TEST_DATABASE_URL;

void test(
  "preparation API persists step output and key identity without exposing key material",
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
    const { createWorkspacePrivateKey, getWorkspacePrivateKeyValue } =
      await import("../private-keys/service.js");
    const { promoteVerifiedServerPrivateKey } =
      await import("../secrets/store.js");
    const { getServerPreparationExecutionContext, listServerPreparations } =
      await import("./preparations.js");
    const { internalServerPreparationRoutes } =
      await import("../../routes/v1/internal/server-preparations.js");
    const { HttpError } = await import("../../http/errors.js");
    const { normalizeError } = await import("../../http/error-response.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID(),
      userId = randomUUID(),
      serverId = randomUUID(),
      preparationId = randomUUID();
    const config = normalizeServerConfiguration({
      ip: "192.0.2.200",
      ssh: { username: "deploy" },
    });
    try {
      await db.insert(workspaces).values({
        id: workspaceId,
        slug: workspaceId,
        name: "Preparation test",
      });
      await db.insert(users).values({
        id: userId,
        email: `${userId}@example.com`,
        displayName: "Test",
      });
      await db
        .insert(workspaceMembers)
        .values({ workspaceId, userId, role: "admin" });
      const key = await createWorkspacePrivateKey({
        algorithm: "ed25519",
        name: "Preparation test key",
        requestedBy: userId,
        workspaceId,
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: config.ip,
        config,
        configDigest: "test",
        privateKeyId: key.id,
      });
      const privateKey = await getWorkspacePrivateKeyValue(key.id, workspaceId);
      await db.transaction((transaction) =>
        promoteVerifiedServerPrivateKey(
          {
            actorUserId: userId,
            expectedRevision: null,
            privateKey,
            privateKeyId: key.id,
            serverId,
            workspaceId,
          },
          transaction,
        ),
      );
      const steps = createServerPreparationSteps();
      await db.insert(serverPreparations).values({
        id: preparationId,
        serverId,
        configDigest: "test",
        status: "running",
        steps,
      });
      const execution =
        await getServerPreparationExecutionContext(preparationId);
      assert.equal(execution.privateKeyName, key.name);
      assert.equal(execution.login.privateKey, privateKey);

      const api = new Hono();
      api.onError((error, c) => {
        const normalized = normalizeError(error);
        return c.json({ error: normalized.message }, normalized.status);
      });
      api.route("/preparations", internalServerPreparationRoutes);
      const send = (body: unknown) =>
        api.request(`/preparations/${preparationId}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      steps[0]!.status = "succeeded";
      steps[0]!.message = "Connected using Preparation test key";
      steps[0]!.log =
        "[stdout] Pinned host key matched. SSH authentication succeeded.\n";
      steps[0]!.logTruncated = false;
      assert.equal((await send({ status: "running", steps })).status, 200);
      let persisted = (await listServerPreparations(serverId, workspaceId))[0]!;
      assert.equal(persisted.steps[0]!.log, steps[0]!.log);
      steps[1]!.log = "[stderr] Ubuntu release is unsupported\n";
      steps[1]!.status = "failed";
      assert.equal(
        (
          await send({
            status: "failed",
            steps,
            errorCode: "UNSUPPORTED_OS",
            errorMessage: "Ubuntu release is unsupported",
          })
        ).status,
        200,
      );
      persisted = (await listServerPreparations(serverId, workspaceId))[0]!;
      assert.equal(persisted.status, "failed");
      assert.equal(persisted.steps[1]!.log, steps[1]!.log);
      assert.doesNotMatch(JSON.stringify(persisted), /BEGIN .*PRIVATE KEY/);
      await assert.rejects(
        listServerPreparations(serverId, randomUUID()),
        (error: unknown) => error instanceof HttpError && error.status === 404,
      );
      steps[0]!.log = "x".repeat(serverPreparationStepLogMaxLength + 1);
      assert.equal((await send({ status: "running", steps })).status, 400);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await db.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
