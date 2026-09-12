import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { apps, auditEvents } from "@workspace/towbar-database/schema";
import { readSecretValues } from "./store.js";
import type { TestContext } from "node:test";
import type { Hono } from "hono";
import type { TowbarHonoEnvironment } from "../../http/types.js";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import type { SecretSlot } from "./store.js";
import type { normalizeDeploymentManifest } from "@workspace/towbar-core";
type Manifest = ReturnType<typeof normalizeDeploymentManifest>;

export async function testBulkReveal({
  t,
  db,
  api,
  appId,
  sourceId,
  slot,
  sharedSlot,
  globalSlot,
  workspaceId,
  otherWorkspaceId,
  manifest,
  appConfig,
  setRole,
  setWorkspace,
}: {
  t: TestContext;
  db: ReturnType<typeof getTowbarDatabase>;
  api: Hono<TowbarHonoEnvironment>;
  appId: string;
  sourceId: string;
  workspaceId: string;
  otherWorkspaceId: string;
  slot: SecretSlot;
  sharedSlot: SecretSlot;
  globalSlot: SecretSlot;
  manifest: Manifest;
  appConfig: NonNullable<Manifest["apps"]>[number];
  setRole: (role: "owner" | "member") => void;
  setWorkspace: (id: string) => void;
}) {
  await t.test(
    "bulk reveal is scoped, owner-only, uncached, and value-free in audits",
    async () => {
      const revealAll = (path: string) =>
        api.request(`${path}/reveal-all`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
      const path = `/apps/${appId}/secrets/production/deployment`;
      setRole("member");
      assert.equal((await revealAll(path)).status, 403);
      setRole("owner");
      setWorkspace(otherWorkspaceId);
      assert.equal((await revealAll(path)).status, 404);
      setWorkspace(workspaceId);
      for (const [route, target] of [
        [path, slot],
        [`/sources/${sourceId}/secrets/production/deployment`, sharedSlot],
        ["/settings/secrets/production/deployment", globalSlot],
      ] as const) {
        const expected = await readSecretValues(target);
        const response = await revealAll(route);
        assert.equal(response.status, 200);
        assert.match(response.headers.get("cache-control") ?? "", /no-store/u);
        assert.deepEqual(await response.json(), expected);
      }
      const empty = await revealAll(
        `/apps/${appId}/secrets/preview:production/post_deploy`,
      );
      assert.equal(empty.status, 200);
      assert.deepEqual(
        await empty.json(),
        await readSecretValues({
          ...slot,
          environment: "preview:production",
          stage: "post_deploy",
        }),
      );
      const events = await db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.action, "secrets.revealed"));
      const bulk = events.filter(
        (event) => event.metadata && "keyCount" in event.metadata,
      );
      assert.equal(bulk.length, 4);
      assert(!JSON.stringify(bulk).includes("line one"));
      assert(!JSON.stringify(bulk).includes("shared-value"));
      await db
        .update(apps)
        .set({ kind: "postgres", config: manifest.resources![0]! })
        .where(eq(apps.id, appId));
      try {
        assert.equal(
          (
            await revealAll(
              `/resources/${appId}/secrets/preview:production/deployment`,
            )
          ).status,
          422,
        );
        assert.equal(
          (await revealAll(`/resources/${appId}/secrets/production/build`))
            .status,
          422,
        );
        const response = await revealAll(
          `/resources/${appId}/secrets/production/deployment`,
        );
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), await readSecretValues(slot));
      } finally {
        await db
          .update(apps)
          .set({ kind: "app", config: appConfig })
          .where(eq(apps.id, appId));
      }
    },
  );
}
