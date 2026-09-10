import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq } from "drizzle-orm";
import {
  digestValue,
  normalizeServerConfiguration,
} from "@workspace/towbar-core";
import {
  apps,
  githubInstallations,
  servers,
  sourceEnvironments,
  sourceSyncs,
  sources,
  users,
  workspaces,
} from "@workspace/towbar-database/schema";

const url = process.env.TOWBAR_TEST_DATABASE_URL;
void test(
  "environment sync preserves instance and secret isolation",
  { skip: !url },
  async (t) => {
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
    const { executeEnvironmentSync } = await import("./environment-sync.js");
    const { readSecretValues, readSecretMetadata, mutateSecret } =
      await import("../secrets/store.js");
    const database = getTowbarDatabase();
    const workspaceId = randomUUID(),
      sourceId = randomUUID(),
      userId = randomUUID();
    const root = "version: 2\nenvironments:\n  production: {}\n  staging: {}\n";
    let keys = ["TOKEN", "EMPTY"];
    let broken = false;
    const dependencies = {
      snapshot: () =>
        Promise.resolve({
          commitSha: "a".repeat(40),
          root,
          configuration: {
            version: 2 as const,
            environments: { production: {}, staging: {} },
          },
          directories: [".towbar/apps"],
          files: [
            {
              path: ".towbar/apps/site.app.yml",
              content: JSON.stringify({
                id: "site",
                name: "Site",
                dockerfile: "Dockerfile",
                container: { port: 3000 },
                secrets: { runtime: keys },
                environments: {
                  production: {
                    server: "host",
                    domains: { primary: "prod.example.com" },
                  },
                  staging: {
                    server: broken ? "missing-host" : "host",
                    domains: { primary: "stage.example.com" },
                  },
                },
              }),
            },
          ],
        }),
      tree: () => Promise.resolve({ complete: true, entries: [] }),
    };
    try {
      await database
        .insert(workspaces)
        .values({ id: workspaceId, slug: workspaceId, name: "V2 test" });
      await database
        .insert(users)
        .values({
          id: userId,
          email: `${userId}@example.com`,
          displayName: "Test",
        });
      const [installation] = await database
        .insert(githubInstallations)
        .values({
          workspaceId,
          installationId: randomUUID(),
          accountLogin: "test",
          accountType: "Organization",
        })
        .returning();
      await database
        .insert(sources)
        .values({
          id: sourceId,
          workspaceId,
          githubInstallationId: installation!.id,
          repositoryOwner: "test",
          repositoryName: "test",
          branch: "main",
        });
      const config = normalizeServerConfiguration({
        ip: "192.0.2.10",
        ssh: { username: "deploy" },
      });
      await database
        .insert(servers)
        .values({
          workspaceId,
          slug: "host",
          canonicalIp: config.ip,
          config,
          configDigest: digestValue(config),
        });
      const [production, staging] = await database
        .insert(sourceEnvironments)
        .values([
          { sourceId, name: "production", branch: "main" },
          { sourceId, name: "staging", branch: "develop" },
        ])
        .returning();
      async function sync(
        environment: NonNullable<typeof production>,
        revision = environment.mappingRevision,
      ) {
        const [job] = await database
          .insert(sourceSyncs)
          .values({
            sourceId,
            sourceEnvironmentId: environment.id,
            mappingRevision: revision,
          })
          .returning();
        return executeEnvironmentSync(job!.id, workspaceId, dependencies);
      }
      await sync(production!);
      await sync(staging!);
      const instances = await database
        .select()
        .from(apps)
        .where(eq(apps.sourceId, sourceId));
      assert.equal(instances.length, 2);
      assert.equal(instances[0]!.entityId, instances[1]!.entityId);
      assert.notEqual(instances[0]!.id, instances[1]!.id);
      const prod = instances.find(
        (row) => row.sourceEnvironmentId === production!.id,
      )!;
      const stage = instances.find(
        (row) => row.sourceEnvironmentId === staging!.id,
      )!;
      const slot = {
        type: "app" as const,
        id: stage.id,
        workspaceId,
        environment: "staging",
        stage: "deployment",
      };
      const prodSlot = { ...slot, id: prod.id, environment: "production" };
      await t.test("new declarations are visible but unset", async () => {
        assert.deepEqual((await readSecretMetadata(slot)).missingKeys, [
          "EMPTY",
          "TOKEN",
        ]);
        assert.deepEqual(
          Object.keys((await readSecretValues(slot)).values),
          [],
        );
      });
      const metadata = await readSecretMetadata(slot);
      await mutateSecret(
        slot,
        {
          expectedRevision: metadata.revision,
          set: { TOKEN: "stage-value", EMPTY: "" },
          delete: [],
        },
        userId,
      );
      await t.test("values cannot cross environment boundaries", async () => {
        assert.deepEqual(
          Object.keys((await readSecretValues(prodSlot)).values),
          [],
        );
        await assert.rejects(
          readSecretValues({ ...slot, environment: "production" }),
          /does not match/,
        );
      });
      await t.test(
        "sync preserves empty values, adds unset keys and removes deleted values only in staging",
        async () => {
          keys = ["EMPTY", "ADDED"];
          await sync(staging!);
          assert.deepEqual(
            { ...(await readSecretValues(slot)).values },
            { EMPTY: "" },
          );
          assert.deepEqual((await readSecretMetadata(slot)).missingKeys, [
            "ADDED",
          ]);
          assert.deepEqual((await readSecretMetadata(prodSlot)).keys, [
            "EMPTY",
            "TOKEN",
          ]);
        },
      );
      await t.test(
        "invalid sync rolls back inventory and secret removal",
        async () => {
          keys = [];
          broken = true;
          await assert.rejects(sync(staging!), /missing-host/);
          assert.deepEqual((await readSecretMetadata(slot)).keys, [
            "ADDED",
            "EMPTY",
          ]);
          const [retained] = await database
            .select()
            .from(apps)
            .where(
              and(eq(apps.id, stage.id), eq(apps.workspaceId, workspaceId)),
            );
          assert.equal(retained!.config.server, "host");
          broken = false;
        },
      );
      await t.test(
        "changed branch mapping rejects a previously queued sync",
        async () => {
          await database
            .update(sourceEnvironments)
            .set({ mappingRevision: randomUUID(), branch: "next" })
            .where(eq(sourceEnvironments.id, staging!.id));
          await assert.rejects(sync(staging!), /mapping changed/);
          assert.deepEqual((await readSecretMetadata(slot)).keys, [
            "ADDED",
            "EMPTY",
          ]);
        },
      );
    } finally {
      await database.delete(workspaces).where(eq(workspaces.id, workspaceId));
      await database.delete(users).where(eq(users.id, userId));
      await closeDatabase();
    }
  },
);
