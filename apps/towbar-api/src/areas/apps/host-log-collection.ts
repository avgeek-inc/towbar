import { collectsHostDockerLogs } from "@workspace/towbar-core";
import type {
  NormalizedDeployable,
  NormalizedServer,
} from "@workspace/towbar-core";
import type { Action } from "@workspace/towbar-access";
import { and, eq } from "drizzle-orm";
import { deployments } from "@workspace/towbar-database/schema";
import { conflict, notFound } from "../../http/errors.js";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export function hostLogDeploymentPermissions(
  ...deployables: NormalizedDeployable[]
): Action[] {
  return deployables.some(collectsHostDockerLogs)
    ? ["deployment.create", "server.collectLogs"]
    : ["deployment.create"];
}

export function requireHostLogCollection(
  server: NormalizedServer,
  ...deployables: NormalizedDeployable[]
) {
  if (deployables.some(collectsHostDockerLogs) && !server.hostLogCollection)
    throw conflict(
      "An Admin must allow Docker log collection in this server's settings before deploying a collector.",
      "HOST_LOG_COLLECTION_DISABLED",
    );
}

export async function hostLogExecutionDeployables(context: {
  app: NormalizedDeployable;
  currentServerConfig: NormalizedServer;
  environment: "production" | "preview";
  kind: "deploy" | "rollback";
  rollbackRelease: { sourceDeploymentId: string } | null;
  workspaceId: string;
}) {
  const deployables = [context.app];
  if (context.kind === "rollback") {
    if (!context.rollbackRelease)
      throw new Error("Rollback deployment is missing its release snapshot");
    const [original] = await getTowbarDatabase()
      .select({ app: deployments.appSnapshot })
      .from(deployments)
      .where(
        and(
          eq(deployments.id, context.rollbackRelease.sourceDeploymentId),
          eq(deployments.workspaceId, context.workspaceId),
        ),
      )
      .limit(1);
    if (!original) throw notFound("Release deployment");
    deployables.push(original.app);
  }
  if (
    context.environment === "preview" &&
    deployables.some(collectsHostDockerLogs)
  )
    throw conflict(
      "Host log collectors cannot run in Preview environments",
      "HOST_LOG_COLLECTION_PREVIEW_FORBIDDEN",
    );
  requireHostLogCollection(context.currentServerConfig, ...deployables);
  return deployables;
}
