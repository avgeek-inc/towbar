import { and, eq } from "drizzle-orm";
import { apps, servers } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { readSecretMetadata } from "./store.js";
import type { NormalizedDeploymentManifest } from "@workspace/towbar-core";

export async function inspectManagedSecrets(input: {
  manifest: NormalizedDeploymentManifest;
  scope?: { serverIps: string[]; deployableIds: string[] };
  sourceId: string;
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const [serverRows, appRows, shared] = await Promise.all([
    database
      .select({ id: servers.id, ip: servers.canonicalIp })
      .from(servers)
      .where(
        and(
          eq(servers.sourceId, input.sourceId),
          eq(servers.workspaceId, input.workspaceId),
        ),
      ),
    database
      .select({ id: apps.id, manifestId: apps.manifestId })
      .from(apps)
      .where(
        and(
          eq(apps.sourceId, input.sourceId),
          eq(apps.workspaceId, input.workspaceId),
        ),
      ),
    readSecretMetadata({
      type: "source",
      id: input.sourceId,
      workspaceId: input.workspaceId,
      environment: "production",
      stage: "deployment",
    }),
  ]);
  const checks: Array<{ available: boolean; reference: string }> = [];
  for (const server of input.manifest.servers) {
    if (input.scope && !input.scope.serverIps.includes(server.ip)) continue;
    const row = serverRows.find((row) => row.ip === server.ip);
    const metadata = row
      ? await readSecretMetadata({
          type: "server",
          id: row.id,
          workspaceId: input.workspaceId,
          environment: "production",
          stage: "credentials",
        })
      : { keys: [] as string[] };
    checks.push({
      available: metadata.keys.includes("privateKey"),
      reference: `Server ${server.ip} → Credentials → SSH private key`,
    });
    if (server.proxy?.cloudflare.enabled)
      checks.push({
        available: metadata.keys.includes("apiToken"),
        reference: `Server ${server.ip} → Credentials → Cloudflare API token`,
      });
  }
  for (const resource of input.manifest.resources ?? []) {
    if (input.scope && !input.scope.deployableIds.includes(resource.id))
      continue;
    const key =
      resource.kind === "postgres"
        ? "POSTGRES_PASSWORD"
        : resource.kind === "redis"
          ? "REDIS_PASSWORD"
          : null;
    if (!key) continue;
    const row = appRows.find((row) => row.manifestId === resource.id);
    const local = row
      ? await readSecretMetadata({
          type: "app",
          id: row.id,
          workspaceId: input.workspaceId,
          environment: "production",
          stage: "deployment",
        })
      : { keys: [] as string[] };
    checks.push({
      available: local.keys.includes(key) || shared.keys.includes(key),
      reference: `Resource ${resource.name} → Secrets → ${key}`,
    });
  }
  return checks;
}
