import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { managedSecrets } from "@workspace/towbar-database/schema";
import {
  listEnvironmentSecrets,
  resolveEnvironmentStage,
} from "../apps/secrets.js";
import { mutateSecret, readSecretMetadata } from "./store.js";
import type { TestContext } from "node:test";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import type { SecretOwner, SecretSlot } from "./store.js";

export async function testManagedSecretInheritance({
  t,
  db,
  workspaceId,
  actorUserId,
  sourceId,
  appId,
  workspaceOwner,
  sourceOwner,
  appOwner,
  globalSlot,
  sharedSlot,
  slot,
}: {
  t: TestContext;
  db: ReturnType<typeof getTowbarDatabase>;
  workspaceId: string;
  actorUserId: string;
  sourceId: string;
  appId: string;
  workspaceOwner: Extract<SecretOwner, { type: "workspace" }>;
  sourceOwner: Extract<SecretOwner, { type: "source" }>;
  appOwner: Extract<SecretOwner, { type: "app" }>;
  globalSlot: SecretSlot;
  sharedSlot: SecretSlot;
  slot: SecretSlot;
}) {
  await t.test(
    "encrypted storage, write-only metadata, explicit references, and versioned writes",
    async () => {
      await mutateSecret(
        globalSlot,
        {
          expectedRevision: null,
          set: { TOKEN: "global-value", GLOBAL_ONLY: "global-only" },
          delete: [],
        },
        actorUserId,
      );
      await mutateSecret(
        sharedSlot,
        {
          expectedRevision: null,
          set: { TOKEN: "shared-value", COMMON: "common-value" },
          delete: [],
        },
        actorUserId,
      );
      const saved = await mutateSecret(
        slot,
        {
          expectedRevision: null,
          set: {
            TOKEN: "local-value",
            MULTILINE: "line one\nline two",
            EMPTY: "",
          },
          delete: [],
        },
        actorUserId,
      );
      assert(!JSON.stringify(saved).includes("local-value"));
      const result = await resolveEnvironmentStage({
        workspaceId,
        sourceId,
        appId,
        environment: "production",
        stage: "deployment",
      });
      assert.equal(result.values.TOKEN, "local-value");
      assert.equal(result.values.COMMON, undefined);
      assert.equal(result.values.GLOBAL_ONLY, undefined);
      const appBinding = (
        await listEnvironmentSecrets(appOwner, "production")
      ).find((binding) => binding.stage === "deployment");
      assert(appBinding);
      assert.deepEqual(appBinding.inheritedKeys, []);
      assert.deepEqual(appBinding.availableReferences, {
        globals: ["GLOBAL_ONLY", "TOKEN"],
        source: ["COMMON", "TOKEN"],
      });
      const sourceBinding = (
        await listEnvironmentSecrets(sourceOwner, "production")
      ).find((binding) => binding.stage === "deployment");
      assert(sourceBinding);
      assert.deepEqual(sourceBinding.inheritedKeys, []);
      assert.deepEqual(sourceBinding.availableReferences.globals, [
        "GLOBAL_ONLY",
        "TOKEN",
      ]);
      const [stored] = await db
        .select()
        .from(managedSecrets)
        .where(eq(managedSecrets.owner, `app:${appId}`));
      assert(stored);
      assert(!JSON.stringify(stored).includes("local-value"));
      await assert.rejects(
        mutateSecret(
          slot,
          { expectedRevision: saved.revision, set: {}, delete: ["TOKEN"] },
          actorUserId,
        ),
        /declared|required|managed/i,
      );
      assert.equal(
        (
          await resolveEnvironmentStage({
            workspaceId,
            sourceId,
            appId,
            environment: "production",
            stage: "deployment",
          })
        ).values.TOKEN,
        "local-value",
      );
      const shared = await readSecretMetadata(sharedSlot);
      await mutateSecret(
        sharedSlot,
        {
          expectedRevision: shared.revision,
          set: {},
          delete: ["TOKEN"],
        },
        actorUserId,
      );
      assert.equal(
        (
          await resolveEnvironmentStage({
            workspaceId,
            sourceId,
            appId,
            environment: "production",
            stage: "deployment",
          })
        ).values.TOKEN,
        "local-value",
      );
      await mutateSecret(
        sharedSlot,
        {
          expectedRevision: (await readSecretMetadata(sharedSlot)).revision,
          set: { TOKEN: "shared-value" },
          delete: [],
        },
        actorUserId,
      );
      await mutateSecret(
        slot,
        {
          expectedRevision: saved.revision,
          set: {
            TOKEN: "{{source.TOKEN}}",
            COMMON: "{{source.COMMON}}",
            GLOBAL_ONLY: "{{globals.GLOBAL_ONLY}}",
          },
          delete: [],
        },
        actorUserId,
      );
      const explicit = await resolveEnvironmentStage({
        workspaceId,
        sourceId,
        appId,
        environment: "production",
        stage: "deployment",
      });
      assert.equal(explicit.values.TOKEN, "shared-value");
      assert.equal(explicit.values.GLOBAL_ONLY, "global-only");
      await assert.rejects(
        mutateSecret(
          slot,
          {
            expectedRevision: saved.revision,
            set: { TOKEN: "stale" },
            delete: [],
          },
          actorUserId,
        ),
        /changed after loading/u,
      );
    },
  );

  await t.test(
    "environment defaults and hook stages remain isolated",
    async () => {
      await mutateSecret(
        { ...sharedSlot, stage: "pre_deploy" },
        {
          expectedRevision: null,
          set: { MIGRATION: "production-only" },
          delete: [],
        },
        actorUserId,
      );
      await mutateSecret(
        {
          ...workspaceOwner,
          environment: "preview:production",
          stage: "deployment",
        },
        {
          expectedRevision: null,
          set: { GLOBAL_PREVIEW: "global-preview" },
          delete: [],
        },
        actorUserId,
      );
      await mutateSecret(
        {
          ...sourceOwner,
          environment: "preview:production",
          stage: "pre_deploy",
        },
        {
          expectedRevision: null,
          set: { SOURCE_PREVIEW: "source-preview" },
          delete: [],
        },
        actorUserId,
      );
      const preview = await resolveEnvironmentStage({
        workspaceId,
        sourceId,
        appId,
        environment: "preview:production",
        stage: "deployment",
      });
      assert.deepEqual(preview.values, {});
      assert.deepEqual(
        (
          await resolveEnvironmentStage({
            workspaceId,
            sourceId,
            appId,
            environment: "preview:production",
            stage: "pre_deploy",
          })
        ).values,
        {},
      );
      assert.equal(
        (
          await resolveEnvironmentStage({
            workspaceId,
            sourceId,
            appId,
            environment: "production",
            stage: "post_deploy",
          })
        ).values.MIGRATION,
        undefined,
      );
    },
  );
}
