import { randomUUID } from "node:crypto";
import {
  githubInstallations,
  servers,
  sourceEnvironments,
  sources,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function seedConnectedEnvironment(workspaceId: string) {
  const database = getTowbarDatabase();
  const installationId = randomUUID();
  const sourceId = randomUUID();
  await database.insert(githubInstallations).values({
    id: installationId,
    workspaceId,
    installationId,
    accountLogin: "api-test",
    accountType: "Organization",
  });
  await database.insert(sources).values({
    id: sourceId,
    workspaceId,
    githubInstallationId: installationId,
    repositoryOwner: "api-test",
    repositoryName: "platform",
  });
  await database.insert(sourceEnvironments).values({
    sourceId,
    name: "production",
    branch: "main",
  });
}

export async function seedApiServers(
  rows: { id: string; workspaceId: string; ip: string }[],
) {
  await getTowbarDatabase()
    .insert(servers)
    .values(
      rows.map(({ id, workspaceId, ip }) => ({
        id,
        workspaceId,
        slug: `server-${id}`,
        canonicalIp: ip,
        configDigest: "test-digest",
        config: {
          ip,
          ssh: { host: ip, port: 22, username: "ubuntu" },
          buildConcurrency: 1,
        },
      })),
    );
}
