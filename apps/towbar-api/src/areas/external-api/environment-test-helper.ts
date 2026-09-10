import { randomUUID } from "node:crypto";
import {
  githubInstallations,
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
    branch: "main",
  });
  await database.insert(sourceEnvironments).values({
    sourceId,
    name: "production",
    branch: "main",
  });
}
