import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  deployments,
  previewEnvironments,
  releases,
} from "@workspace/towbar-database/schema";
import type { TestContext } from "node:test";
import type { NormalizedApp, NormalizedServer } from "@workspace/towbar-core";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import { resolveDeploymentSecrets } from "../deployments/deployment-secrets.js";
import { admitPreviewDeployment } from "../previews/admission.js";
import { mutateSecret, readSecretMetadata } from "./store.js";
import type { SecretSlot } from "./store.js";

export async function testManagedSecretExecution({
  t,
  db,
  workspaceId,
  actorUserId,
  sourceId,
  serverId,
  appId,
  appConfig,
  serverConfig,
  sharedSlot,
  patch,
  setWorkspaceRole,
  api,
}: {
  api: import("hono").Hono<import("../../http/types.js").TowbarHonoEnvironment>;
  t: TestContext;
  db: ReturnType<typeof getTowbarDatabase>;
  workspaceId: string;
  actorUserId: string;
  sourceId: string;
  serverId: string;
  appId: string;
  appConfig: NormalizedApp;
  serverConfig: NormalizedServer;
  sharedSlot: SecretSlot;
  patch: (path: string, body: unknown) => Promise<Response>;
  setWorkspaceRole: (role: "owner" | "member") => void;
}) {
  const appOwner = { type: "app" as const, id: appId, workspaceId };
  await t.test(
    "deployment resolution records only revisions, keeps running values stable, and rollback uses current values",
    async () => {
      const privateKey = generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString();
      const serverResult = await patch(`/servers/${serverId}/credentials`, {
        expectedRevision: null,
        set: { privateKey, apiToken: "test-cloudflare-token-12345" },
        delete: [],
      });
      assert.equal(serverResult.status, 200);
      assert(!(await serverResult.text()).includes(privateKey));
      const serverMetadata = (await (
        await api.request(`/servers/${serverId}/credentials`)
      ).json()) as { credential: { keys: string[]; revision: string } };
      assert.deepEqual(serverMetadata.credential.keys, [
        "apiToken",
        "privateKey",
      ]);
      const replacement = await patch(`/servers/${serverId}/credentials`, {
        expectedRevision: serverMetadata.credential.revision,
        set: { apiToken: "replacement-cloudflare-token-12345" },
        delete: [],
      });
      assert.equal(replacement.status, 200);
      setWorkspaceRole("member");
      const forbiddenServer = await api.request(
        `/servers/${serverId}/credentials`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-role": "member",
          },
          body: JSON.stringify({
            expectedRevision: null,
            set: { apiToken: "forbidden-cloudflare-token" },
            delete: [],
          }),
        },
      );
      assert.equal(forbiddenServer.status, 403);
      setWorkspaceRole("owner");
      const deploymentId = randomUUID();
      await db.insert(deployments).values({
        id: deploymentId,
        workspaceId,
        sourceId,
        appId,
        serverId,
        idempotencyKey: deploymentId,
        temporalWorkflowId: deploymentId,
        commitSha: "1234567",
        manifestDigest: "digest",
        appSnapshot: appConfig,
        serverSnapshot: serverConfig,
      });
      const resolved = await resolveDeploymentSecrets(deploymentId);
      assert.equal(
        resolved.cloudflare?.apiToken,
        "replacement-cloudflare-token-12345",
      );
      assert.equal(resolved.runtime.TOKEN, "shared-value");
      assert.equal(resolved.hooks.preDeploy.MIGRATION, "production-only");
      const metadata = await readSecretMetadata(sharedSlot);
      await mutateSecret(
        sharedSlot,
        {
          expectedRevision: metadata.revision,
          set: { TOKEN: "rotated" },
          delete: [],
        },
        actorUserId,
      );
      assert.equal(resolved.runtime.TOKEN, "shared-value");
      const [snapshot] = await db
        .select()
        .from(deployments)
        .where(eq(deployments.id, deploymentId));
      assert(snapshot?.secretRevisions);
      assert(!JSON.stringify(snapshot).includes("shared-value"));
      await db
        .update(deployments)
        .set({
          kind: "rollback",
          rollbackReleaseSnapshot: {
            commitSha: "1234567",
            containerName: "test",
            imageTag: "test",
            releaseId: randomUUID(),
            sourceDeploymentId: deploymentId,
          },
        })
        .where(eq(deployments.id, deploymentId));
      const rollback = await resolveDeploymentSecrets(deploymentId);
      assert.equal(rollback.runtime.TOKEN, "rotated");
      assert.deepEqual(rollback.build, {});
      assert.deepEqual(rollback.hooks.preDeploy, {});
      await db.delete(deployments).where(eq(deployments.id, deploymentId));
    },
  );
  await t.test(
    "preview redeployment resolves every isolated stage and requires explicit admission",
    async () => {
      for (const stage of [
        "build",
        "deployment",
        "pre_deploy",
        "post_deploy",
      ] as const) {
        await mutateSecret(
          { ...appOwner, environment: "preview", stage },
          {
            expectedRevision: null,
            set: { PREVIEW_ONLY: `${stage}-preview` },
            delete: [],
          },
          actorUserId,
        );
      }
      const input = {
        appId,
        branch: "feature",
        commitSha: "1234567",
        config: appConfig,
        deploymentDigest: "same-digest",
        hostname: "app-preview.example.com",
        manifestDigest: "digest",
        pullRequestNumber: 12,
        server: serverConfig,
        serverId,
        sourceId,
        sourceInputDigest: null,
        ttlHours: 24,
        workspaceId,
      };
      const initial = await admitPreviewDeployment(input);
      assert(initial.deploymentId);
      const resolved = await resolveDeploymentSecrets(initial.deploymentId);
      assert.deepEqual(resolved.build, { PREVIEW_ONLY: "build-preview" });
      assert.deepEqual(resolved.runtime, {
        PREVIEW_ONLY: "deployment-preview",
      });
      assert.deepEqual(resolved.hooks.preDeploy, {
        PREVIEW_ONLY: "pre_deploy-preview",
      });
      assert.deepEqual(resolved.hooks.postDeploy, {
        PREVIEW_ONLY: "post_deploy-preview",
      });
      await assert.rejects(
        admitPreviewDeployment({ ...input, force: true }),
        /already active/u,
      );
      await db
        .update(deployments)
        .set({ state: "succeeded" })
        .where(eq(deployments.id, initial.deploymentId));
      await db.insert(releases).values({
        appId,
        deploymentId: initial.deploymentId,
        environment: "preview",
        gitRef: "refs/pull/12/head",
        previewEnvironmentId: initial.environmentId,
        status: "current",
        commitSha: "1234567",
        deploymentDigest: "same-digest",
        imageTag: "test",
        containerName: "test",
      });
      const unchanged = await admitPreviewDeployment(input);
      assert.equal(unchanged.created, false);
      const again = await admitPreviewDeployment({
        ...input,
        force: true,
        requestedBy: actorUserId,
      });
      assert(again.created && again.deploymentId !== initial.deploymentId);
      await db
        .update(previewEnvironments)
        .set({ status: "deleting" })
        .where(eq(previewEnvironments.id, initial.environmentId));
      await assert.rejects(
        admitPreviewDeployment({ ...input, force: true }),
        /being removed/u,
      );
      await db
        .delete(releases)
        .where(eq(releases.previewEnvironmentId, initial.environmentId));
      await db
        .delete(deployments)
        .where(eq(deployments.previewEnvironmentId, initial.environmentId));
      await db
        .delete(previewEnvironments)
        .where(eq(previewEnvironments.id, initial.environmentId));
    },
  );
}
