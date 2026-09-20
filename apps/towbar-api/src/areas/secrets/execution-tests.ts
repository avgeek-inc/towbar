import { testDeploymentEnvironment } from "../sources/instance-test-helper.js";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  apps,
  deployments,
  previewEnvironments,
  releases,
  sourceEnvironments,
  sourceSyncs,
  sshHostKeys,
} from "@workspace/towbar-database/schema";
import type { TestContext } from "node:test";
import type { NormalizedApp, NormalizedServer } from "@workspace/towbar-core";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import { resolveDeploymentSecrets } from "../deployments/deployment-secrets.js";
import { getInstanceEnvironment } from "../apps/instance-environment.js";
import { withActor } from "../auth/actor-context.js";
import { admitPreviewDeployment as admitPreview } from "../previews/admission.js";
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
  setWorkspaceRole: (role: "admin" | "member") => void;
}) {
  const admitPreviewDeployment = (...args: Parameters<typeof admitPreview>) =>
    withActor(
      { kind: "session", workspaceId, userId: actorUserId, role: "admin" },
      () => admitPreview(...args),
    );
  const appOwner = { type: "app" as const, id: appId, workspaceId };
  await t.test(
    "deployment resolution records only revisions, keeps running values stable, and rollback uses current values",
    async () => {
      await mutateSecret(
        { ...appOwner, environment: "production", stage: "pre_deploy" },
        {
          expectedRevision: null,
          set: { MIGRATION: "{{source.MIGRATION}}" },
          delete: [],
        },
        actorUserId,
      );
      const privateKey = generateKeyPairSync("ed25519")
        .privateKey.export({ type: "pkcs8", format: "pem" })
        .toString();
      const cloudflareToken = `cfat_${"runtime_account_token_".repeat(3)}`;
      process.env.TOWBAR_CLOUDFLARE_ENABLED = "true";
      process.env.TOWBAR_CLOUDFLARE_ACCOUNT_ID = "test-account";
      process.env.TOWBAR_CLOUDFLARE_API_TOKEN = cloudflareToken;
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
          set: { privateKey },
          delete: [],
        },
        actorUserId,
      );
      const serverMetadata = (await (
        await api.request(`/servers/${serverId}/credentials`)
      ).json()) as { credential: { keys: string[]; revision: string } };
      assert.deepEqual(serverMetadata.credential.keys, ["privateKey"]);
      const unverifiedPrivateKey = await patch(
        `/servers/${serverId}/credentials`,
        {
          expectedRevision: serverMetadata.credential.revision,
          set: { privateKey },
          delete: [],
        },
      );
      assert.equal(unverifiedPrivateKey.status, 422);
      assert(!(await unverifiedPrivateKey.text()).includes(privateKey));
      const rejectedIntegrationSecret = await patch(
        `/servers/${serverId}/credentials`,
        {
          expectedRevision: serverMetadata.credential.revision,
          set: { apiToken: "must-not-be-stored-in-the-control-plane" },
          delete: [],
        },
      );
      assert.equal(rejectedIntegrationSecret.status, 422);
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
      setWorkspaceRole("admin");
      const deploymentId = randomUUID();
      await db.insert(deployments).values({
        targetEnvironment: await testDeploymentEnvironment(appId),
        requiredSecrets: {
          build: [],
          runtime: ["TOKEN"],
          preDeploy: ["MIGRATION"],
          postDeploy: [],
        },
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
      assert.equal(resolved.cloudflare?.apiToken, cloudflareToken);
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
          { ...appOwner, environment: "preview:production", stage },
          {
            expectedRevision: null,
            set: {
              PREVIEW_ONLY: `${stage}-preview`,
              ...(stage === "deployment"
                ? { GLOBAL_PREVIEW: "{{globals.GLOBAL_PREVIEW}}" }
                : {}),
              ...(stage === "pre_deploy"
                ? { SOURCE_PREVIEW: "{{source.SOURCE_PREVIEW}}" }
                : {}),
            },
            delete: [],
          },
          actorUserId,
        );
      }
      const targetEnvironment = await getInstanceEnvironment({
        appId,
        workspaceId,
      });
      assert(targetEnvironment);
      const [target] = await db
        .select({ configDigest: apps.configDigest })
        .from(apps)
        .where(eq(apps.id, appId));
      assert(target);
      const input = {
        targetEnvironment,
        targetConfigDigest: target.configDigest,
        requiredSecrets: {
          build: ["PREVIEW_ONLY"],
          runtime: ["PREVIEW_ONLY", "GLOBAL_PREVIEW"],
          preDeploy: ["PREVIEW_ONLY", "SOURCE_PREVIEW"],
          postDeploy: ["PREVIEW_ONLY"],
        },
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
      await assert.rejects(
        admitPreviewDeployment({ ...input, sourceId: randomUUID() }),
        /preview target changed/,
      );
      const initial = await admitPreviewDeployment(input);
      assert(initial.deploymentId);
      const resolved = await resolveDeploymentSecrets(initial.deploymentId);
      assert.deepEqual(resolved.build, { PREVIEW_ONLY: "build-preview" });
      assert.deepEqual(resolved.runtime, {
        GLOBAL_PREVIEW: "global-preview",
        PREVIEW_ONLY: "deployment-preview",
      });
      assert.deepEqual(resolved.hooks.preDeploy, {
        PREVIEW_ONLY: "pre_deploy-preview",
        SOURCE_PREVIEW: "source-preview",
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
  await t.test(
    "removing the SSH private key forgets every trusted host key",
    async () => {
      await db.insert(sshHostKeys).values({
        algorithm: "ssh-ed25519",
        fingerprint: "SHA256:test-host-key",
        publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestHostKey",
        serverId,
        trustedBy: actorUserId,
      });
      const before = (await (
        await api.request(`/servers/${serverId}/credentials`)
      ).json()) as { credential: { revision: string } };
      const removed = await patch(`/servers/${serverId}/credentials`, {
        expectedRevision: before.credential.revision,
        set: {},
        delete: ["privateKey"],
      });
      assert.equal(removed.status, 200);
      const metadata = (await removed.json()) as {
        credential: { keys: string[] };
      };
      assert.deepEqual(metadata.credential.keys, []);
      assert.deepEqual(
        await db
          .select({ id: sshHostKeys.id })
          .from(sshHostKeys)
          .where(eq(sshHostKeys.serverId, serverId)),
        [],
      );
    },
  );
}

export async function createSecretTestEnvironment(
  db: ReturnType<typeof getTowbarDatabase>,
  sourceId: string,
) {
  const [environment] = await db
    .insert(sourceEnvironments)
    .values({
      sourceId,
      name: "production",
      branch: "main",
      previewsEnabled: true,
    })
    .returning();
  const [initialSync] = await db
    .insert(sourceSyncs)
    .values({
      sourceId,
      sourceEnvironmentId: environment!.id,
      mappingRevision: environment!.mappingRevision,
      status: "succeeded",
      commitSha: "1234567",
    })
    .returning();
  await db
    .update(sourceEnvironments)
    .set({
      latestSuccessfulSyncId: initialSync!.id,
      latestCommitSha: "1234567",
    })
    .where(eq(sourceEnvironments.id, environment!.id));

  return environment!;
}
