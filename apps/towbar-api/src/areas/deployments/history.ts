import { and, count, desc, eq } from "drizzle-orm";

import { apps, deployments } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { publicDeploymentSelection } from "../deployment-selection.js";
import { attachDeploymentQueueBlockers } from "./queue-blocker-query.js";

export async function listDeploymentHistory({
  limit,
  page,
  workspaceId,
}: {
  limit: number;
  page: number;
  workspaceId: string;
}) {
  const database = getTowbarDatabase();
  const filter = eq(deployments.workspaceId, workspaceId);
  const [items, totalRows] = await Promise.all([
    database
      .select({ ...publicDeploymentSelection, deployableName: apps.name })
      .from(deployments)
      .innerJoin(
        apps,
        and(eq(apps.id, deployments.appId), eq(apps.workspaceId, workspaceId)),
      )
      .where(filter)
      .orderBy(desc(deployments.createdAt), desc(deployments.id))
      .limit(limit)
      .offset((page - 1) * limit),
    database.select({ total: count() }).from(deployments).where(filter),
  ]);
  const total = Number(totalRows[0]?.total ?? 0);
  return {
    deployments: await attachDeploymentQueueBlockers(items),
    pagination: { limit, page, total, totalPages: Math.ceil(total / limit) },
  };
}
