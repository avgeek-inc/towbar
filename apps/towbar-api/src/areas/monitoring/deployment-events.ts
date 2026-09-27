import { sql } from "drizzle-orm";
import type { AuthDatabase } from "../../infrastructure/database.js";

export async function getDeploymentEvents(
  database: AuthDatabase,
  scope: {
    workspaceId: string;
    serverId: string;
    deployableId?: string;
    start: Date;
    end: Date;
    limit: number;
  },
) {
  const workload = scope.deployableId
    ? sql`app_id=${scope.deployableId}::uuid and preview_environment_id is null`
    : sql`true`;
  const rows = await database.execute<{
    id: string;
    at: string;
    state: string;
  }>(sql`
    select id,created_at::text at,state from towbar_deployments
    where workspace_id=${scope.workspaceId}::uuid and server_id=${scope.serverId}::uuid
      and created_at>=${scope.start.toISOString()}::timestamptz and created_at<${scope.end.toISOString()}::timestamptz
      and ${workload} order by created_at desc,id desc limit ${scope.limit}`);
  return rows.map((row) => ({
    ...row,
    at: new Date(row.at).toISOString(),
    type: "deployment" as const,
  }));
}
