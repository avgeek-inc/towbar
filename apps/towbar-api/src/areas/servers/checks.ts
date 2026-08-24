import { count, desc, eq } from "drizzle-orm";

import { serverChecks } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getServer } from "./service.js";

const publicServerCheckSelection = {
  createdAt: serverChecks.createdAt,
  errorCode: serverChecks.errorCode,
  errorMessage: serverChecks.errorMessage,
  finishedAt: serverChecks.finishedAt,
  id: serverChecks.id,
  result: serverChecks.result,
  startedAt: serverChecks.startedAt,
  status: serverChecks.status,
} as const;

export async function listServerChecks({
  limit,
  page,
  serverId,
  workspaceId,
}: {
  limit: number;
  page: number;
  serverId: string;
  workspaceId: string;
}) {
  await getServer(serverId, workspaceId);
  const database = getTowbarDatabase();
  const filter = eq(serverChecks.serverId, serverId);
  const [checks, totalRows] = await Promise.all([
    database
      .select(publicServerCheckSelection)
      .from(serverChecks)
      .where(filter)
      .orderBy(desc(serverChecks.createdAt), desc(serverChecks.id))
      .limit(limit)
      .offset((page - 1) * limit),
    database.select({ total: count() }).from(serverChecks).where(filter),
  ]);
  const total = Number(totalRows[0]?.total ?? 0);
  const latestCheck =
    page === 1
      ? (checks[0] ?? null)
      : ((
          await database
            .select(publicServerCheckSelection)
            .from(serverChecks)
            .where(filter)
            .orderBy(desc(serverChecks.createdAt), desc(serverChecks.id))
            .limit(1)
        )[0] ?? null);

  return {
    checks,
    latestCheck,
    pagination: {
      limit,
      page,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
