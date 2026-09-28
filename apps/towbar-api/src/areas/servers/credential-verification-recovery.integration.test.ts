import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  encryptCredential,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  serverChecks,
  serverCredentialVerifications,
  servers,
  workspaces,
} from "@workspace/towbar-database/schema";

const databaseUrl = process.env.TOWBAR_TEST_DATABASE_URL;
const responseSchema = z.object({
  check: z
    .object({
      id: z.string().uuid(),
      status: z.enum(["queued", "running", "succeeded", "failed"]),
      errorCode: z.string().nullable(),
      finishedAt: z.string().nullable(),
    })
    .passthrough(),
});

void test(
  "credential interruption preserves terminal results and releases active candidates",
  { skip: !databaseUrl },
  async () => {
    assert(databaseUrl && new URL(databaseUrl).pathname.endsWith("_test"));
    const masterKey = randomBytes(32);
    process.env.DATABASE_TOWBAR_URL = databaseUrl;
    process.env.TOWBAR_CREDENTIALS_KEY = masterKey.toString("base64");
    process.env.TOWBAR_INTERNAL_HMAC_SECRET = randomBytes(32).toString("hex");
    const { runTowbarMigrations } =
      await import("@workspace/towbar-database/migrate");
    await runTowbarMigrations({
      databaseUrl,
      logger: { info() {}, error() {} },
    });
    const { getTowbarDatabase, closeDatabase } =
      await import("../../infrastructure/database.js");
    const { internalServerCheckRoutes } =
      await import("../../routes/v1/internal/server-checks.js");
    const { normalizeError } = await import("../../http/error-response.js");
    const {
      finishServerCredentialVerification,
      getServerCredentialVerificationExecutionContext,
    } = await import("./credential-verification.js");
    const db = getTowbarDatabase();
    const workspaceId = randomUUID();
    const serverId = randomUUID();
    const config = normalizeServerConfiguration({
      ip: "192.0.2.241",
      ssh: { username: "deploy" },
    });
    const hostKey = {
      algorithm: "ssh-ed25519",
      fingerprint: "SHA256:test",
      publicKey: "test",
    };
    const api = new Hono();
    api.onError((error, context) => {
      const normalized = normalizeError(error);
      return context.json({ error: normalized.message }, normalized.status);
    });
    api.route("/checks", internalServerCheckRoutes);
    const interrupt = (id: string) =>
      api.request(`/checks/${id}/interrupt`, { method: "POST" });
    try {
      await db.insert(workspaces).values({
        id: workspaceId,
        slug: workspaceId,
        name: "Credential recovery test",
      });
      await db.insert(servers).values({
        id: serverId,
        workspaceId,
        canonicalIp: config.ip,
        config,
        configDigest: "test",
      });

      for (const status of ["succeeded", "failed"] as const) {
        const id = randomUUID();
        await db.insert(serverCredentialVerifications).values({
          id,
          serverId,
          status,
          finishedAt: new Date("2026-09-28T12:00:00.000Z"),
          errorCode: status === "failed" ? "HOST_KEY_NOT_TRUSTED" : null,
          errorMessage:
            status === "failed" ? "Trust the discovered host key." : null,
          result:
            status === "failed"
              ? { discoveredHostKeys: [hostKey] }
              : { hostKey },
        });
        const response = await interrupt(id);
        assert.equal(response.status, 200);
        const { check } = responseSchema.parse(await response.json());
        assert.equal(check.id, id);
        assert.equal(check.status, status);
        assert.equal(
          check.errorCode,
          status === "failed" ? "HOST_KEY_NOT_TRUSTED" : null,
        );
        assert.deepEqual(
          check.result,
          status === "failed" ? { discoveredHostKeys: [hostKey] } : { hostKey },
        );
        assert.equal("encryptedPrivateKey" in check, false);
        assert.deepEqual(await (await interrupt(id)).json(), { check });
        const late = await api.request(`/checks/${id}/events`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            status: "succeeded",
            result: { hostKey: "late result" },
          }),
        });
        assert.equal(late.status, 200);
        assert.deepEqual(await late.json(), { check });
        assert.equal(
          await getServerCredentialVerificationExecutionContext(id),
          null,
        );
      }

      for (const status of ["queued", "running"] as const) {
        const id = randomUUID();
        await db.insert(serverCredentialVerifications).values({
          id,
          serverId,
          status,
          startedAt: status === "running" ? new Date() : null,
          encryptedPrivateKey: encryptCredential({
            associatedData: `server-credential-verification:${workspaceId}:${serverId}:${id}`,
            masterKey,
            value: "Disposable credential candidate",
          }),
        });
        const response = await interrupt(id);
        assert.equal(response.status, 200);
        const { check } = responseSchema.parse(await response.json());
        assert.equal(check.status, "failed");
        assert.equal(check.errorCode, "CREDENTIAL_VERIFICATION_INTERRUPTED");
        assert(check.finishedAt);
        assert.equal("encryptedPrivateKey" in check, false);
        assert.deepEqual(await (await interrupt(id)).json(), { check });
        const [persisted] = await db
          .select()
          .from(serverCredentialVerifications)
          .where(eq(serverCredentialVerifications.id, id));
        assert.equal(persisted?.encryptedPrivateKey, null);
        assert.equal(
          await getServerCredentialVerificationExecutionContext(id),
          null,
        );
        await finishServerCredentialVerification(id, {
          status: "succeeded",
          result: { hostKey },
        });
        await finishServerCredentialVerification(id, {
          status: "failed",
          errorCode: "LATE_FAILURE",
          errorMessage: "Late failure",
        });
        assert.deepEqual(await (await interrupt(id)).json(), { check });
      }

      const racingId = randomUUID();
      await db
        .insert(serverCredentialVerifications)
        .values({ id: racingId, serverId, status: "running" });
      await Promise.all([
        interrupt(racingId),
        finishServerCredentialVerification(racingId, {
          status: "failed",
          errorCode: "HOST_KEY_NOT_TRUSTED",
          errorMessage: "Trust the host key.",
          result: { discoveredHostKeys: [hostKey] },
        }),
      ]);
      const terminal = responseSchema.parse(
        await (await interrupt(racingId)).json(),
      );
      assert(terminal.check.errorCode);
      assert(
        [
          "CREDENTIAL_VERIFICATION_INTERRUPTED",
          "HOST_KEY_NOT_TRUSTED",
        ].includes(terminal.check.errorCode),
      );
      await finishServerCredentialVerification(racingId, {
        status: "succeeded",
        result: {},
      });
      assert.deepEqual(await (await interrupt(racingId)).json(), terminal);

      const normalId = randomUUID();
      await db
        .insert(serverChecks)
        .values({ id: normalId, serverId, status: "queued" });
      const normal = await interrupt(normalId);
      assert.equal(normal.status, 200);
      assert.equal(
        responseSchema.parse(await normal.json()).check.errorCode,
        "SERVER_CHECK_INTERRUPTED",
      );
      assert.equal((await interrupt(randomUUID())).status, 404);
      const [server] = await db
        .select()
        .from(servers)
        .where(eq(servers.id, serverId));
      assert.equal(server?.privateKeyId, null);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await closeDatabase();
    }
  },
);
