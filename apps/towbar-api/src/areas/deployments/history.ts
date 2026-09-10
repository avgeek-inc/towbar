import { and, asc, count, desc, eq, isNotNull, isNull, ne } from "drizzle-orm";

import {
  apps,
  deployments,
  sourceEnvironments,
  sources,
} from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { publicDeploymentSelection } from "../deployment-selection.js";
import { attachDeploymentQueueBlockers } from "./queue-blocker-query.js";

import type { z } from "zod";
import type { historyQuerySchema } from "./history-query.js";

export async function listDeploymentHistory({
  limit,
  page,
  workspaceId,
  environment,
  targetEnvironment,
  type,
  state,
  trigger,
  serverId,
  sort = "newest",
}: Omit<z.output<typeof historyQuerySchema>, "sort"> & {
  sort?: z.output<typeof historyQuerySchema>["sort"];
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const filter = and(
    eq(deployments.workspaceId, workspaceId),
    environment ? eq(deployments.environment, environment) : undefined,
    targetEnvironment
      ? eq(sourceEnvironments.name, targetEnvironment)
      : undefined,
    type === "app"
      ? eq(deployments.deployableKind, "app")
      : type === "resource"
        ? ne(deployments.deployableKind, "app")
        : undefined,
    state ? eq(deployments.state, state) : undefined,
    serverId ? eq(deployments.serverId, serverId) : undefined,
    trigger === "rollback"
      ? eq(deployments.kind, "rollback")
      : trigger === "auto_deploy"
        ? and(ne(deployments.kind, "rollback"), isNull(deployments.requestedBy))
        : trigger === "manual"
          ? and(
              ne(deployments.kind, "rollback"),
              isNotNull(deployments.requestedBy),
            )
          : undefined,
  );
  const order =
    sort === "oldest"
      ? [asc(deployments.createdAt), asc(deployments.id)]
      : sort === "name_asc"
        ? [asc(apps.name), desc(deployments.createdAt), desc(deployments.id)]
        : sort === "name_desc"
          ? [desc(apps.name), desc(deployments.createdAt), desc(deployments.id)]
          : [desc(deployments.createdAt), desc(deployments.id)];
  const [items, totalRows, environmentRows] = await Promise.all([
    database
      .select({
        ...publicDeploymentSelection,
        deployableName: apps.name,
        targetEnvironment: {
          id: sourceEnvironments.id,
          name: sourceEnvironments.name,
        },
      })
      .from(deployments)
      .innerJoin(
        apps,
        and(eq(apps.id, deployments.appId), eq(apps.workspaceId, workspaceId)),
      )
      .leftJoin(
        sourceEnvironments,
        and(
          eq(sourceEnvironments.id, apps.sourceEnvironmentId),
          eq(sourceEnvironments.sourceId, apps.sourceId),
        ),
      )
      .where(filter)
      .orderBy(...order)
      .limit(limit)
      .offset((page - 1) * limit),
    database
      .select({ total: count() })
      .from(deployments)
      .innerJoin(
        apps,
        and(eq(apps.id, deployments.appId), eq(apps.workspaceId, workspaceId)),
      )
      .leftJoin(
        sourceEnvironments,
        and(
          eq(sourceEnvironments.id, apps.sourceEnvironmentId),
          eq(sourceEnvironments.sourceId, apps.sourceId),
        ),
      )
      .where(filter),
    database
      .selectDistinct({ name: sourceEnvironments.name })
      .from(sourceEnvironments)
      .innerJoin(sources, eq(sources.id, sourceEnvironments.sourceId))
      .where(eq(sources.workspaceId, workspaceId))
      .orderBy(sourceEnvironments.name),
  ]);
  const total = Number(totalRows[0]?.total ?? 0);
  return {
    environments: environmentRows.map((row) => row.name),
    deployments: await attachDeploymentQueueBlockers(items),
    pagination: { limit, page, total, totalPages: Math.ceil(total / limit) },
  };
}
