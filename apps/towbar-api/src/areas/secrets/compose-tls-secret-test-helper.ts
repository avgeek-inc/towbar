import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { normalizeDeploymentManifest } from "@workspace/towbar-core";
import type { NormalizedServer } from "@workspace/towbar-core";
import { deployments, releases } from "@workspace/towbar-database/schema";
import type { getTowbarDatabase } from "../../infrastructure/database.js";
import { getRuntimeIntegrations } from "../../infrastructure/runtime-integrations.js";
import { resolveDeploymentSecrets } from "../deployments/deployment-secrets.js";
import { testDeploymentEnvironment } from "../sources/instance-test-helper.js";

export async function testComposeTlsSecrets(input: {
  db: ReturnType<typeof getTowbarDatabase>;
  workspaceId: string;
  sourceId: string;
  serverId: string;
  appId: string;
  serverConfig: NormalizedServer;
}) {
  const { db, appId } = input;
  const previousId = randomUUID();
  const currentId = randomUUID();
  const runtime = getRuntimeIntegrations();
  const connection = runtime.providers.cloudflare;
  assert(connection?.provider === "cloudflare");
  const cloudflareToken = connection.credentials.apiToken;
  const snapshot = (hostname: string, mode: "direct" | "cloudflare-dns") =>
    normalizeDeploymentManifest({
      version: 2,
      compose: [
        {
          id: "stack",
          name: "Stack",
          server: input.serverConfig.ip,
          file: "compose.yml",
          services: {
            api: { port: 3000, domains: [hostname], tls: { mode } },
            legacy: { port: 8080, domains: ["legacy.example.com"] },
          },
        },
      ],
    }).compose![0]!;
  const previous = snapshot("old.example.com", "cloudflare-dns");
  const current = snapshot("new.example.com", "cloudflare-dns");
  const base = {
    appId,
    workspaceId: input.workspaceId,
    sourceId: input.sourceId,
    serverId: input.serverId,
    serverSnapshot: input.serverConfig,
    targetEnvironment: await testDeploymentEnvironment(appId),
    requiredSecrets: { build: [], runtime: [], preDeploy: [], postDeploy: [] },
    commitSha: "1234567",
    manifestDigest: "digest",
  };
  try {
    await db.insert(deployments).values(
      [
        { id: previousId, appSnapshot: previous },
        { id: currentId, appSnapshot: current },
      ].map((deployment) => ({
        ...base,
        ...deployment,
        idempotencyKey: deployment.id,
        temporalWorkflowId: deployment.id,
      })),
    );
    await db.insert(releases).values({
      appId,
      deploymentId: previousId,
      status: "current",
      commitSha: base.commitSha,
      imageTag: "compose",
      containerName: "stack",
    });
    const resolved = await resolveDeploymentSecrets(currentId);
    assert.deepEqual(resolved.cloudflare, { apiToken: cloudflareToken });
    assert.deepEqual(resolved.previousCloudflareDns, {
      apiToken: cloudflareToken,
      hostnames: ["old.example.com"],
    });
    assert.equal(resolved.previousCloudflareDnsCleanupBlocked, false);
    assert.equal(resolved.cloudflareTunnel, null);
    const [persisted] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, currentId));
    assert(persisted?.secretRevisions);
    assert(!JSON.stringify(persisted).includes(cloudflareToken));

    await db
      .update(deployments)
      .set({ appSnapshot: snapshot("new.example.com", "direct") })
      .where(eq(deployments.id, currentId));
    const direct = await resolveDeploymentSecrets(currentId);
    assert.equal(direct.cloudflare, null);
    assert.deepEqual(
      direct.previousCloudflareDns,
      resolved.previousCloudflareDns,
    );

    delete runtime.providers.cloudflare;
    const unavailable = await resolveDeploymentSecrets(currentId);
    assert.equal(unavailable.cloudflare, null);
    assert.equal(unavailable.previousCloudflareDns, null);
    assert.equal(unavailable.previousCloudflareDnsCleanupBlocked, true);
    await db
      .update(deployments)
      .set({ appSnapshot: current })
      .where(eq(deployments.id, currentId));
    await assert.rejects(
      resolveDeploymentSecrets(currentId),
      /Configure Cloudflare in the Towbar runtime/,
    );
  } finally {
    runtime.providers.cloudflare = connection;
    await db.delete(releases).where(eq(releases.deploymentId, previousId));
    await db
      .delete(deployments)
      .where(inArray(deployments.id, [previousId, currentId]));
  }
}
