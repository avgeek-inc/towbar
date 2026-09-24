import { and, count, desc, eq, inArray, lt } from "drizzle-orm";

import { serverChecks } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";
import { notFound } from "../../http/errors.js";
import { pruneServerCheckHistory } from "./check-retention.js";
import { getServer } from "./service.js";

const interruptedCheck = {
  errorCode: "SERVER_CHECK_INTERRUPTED",
  errorMessage: "The check was interrupted or timed out before it completed.",
  status: "failed" as const,
};
const serverCheckTimeoutMs = 2 * 60_000;
const recoveryGraceMs = 60_000;

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

export async function markServerCheckInterrupted(checkId: string) {
  const database = getTowbarDatabase();
  const [check] = await database
    .update(serverChecks)
    .set({ ...interruptedCheck, finishedAt: new Date() })
    .where(
      and(
        eq(serverChecks.id, checkId),
        inArray(serverChecks.status, ["queued", "running"]),
      ),
    )
    .returning();
  if (check) {
    await pruneServerCheckHistory(database, check.serverId);
    return check;
  }
  const [existing] = await database
    .select()
    .from(serverChecks)
    .where(eq(serverChecks.id, checkId))
    .limit(1);
  if (!existing) throw notFound("Server check");
  return existing;
}

export async function recoverInterruptedServerChecks(now = new Date()) {
  const database = getTowbarDatabase();
  const recovered = await database
    .update(serverChecks)
    .set({ ...interruptedCheck, finishedAt: now })
    .where(
      and(
        eq(serverChecks.status, "running"),
        lt(
          serverChecks.startedAt,
          new Date(now.getTime() - serverCheckTimeoutMs - recoveryGraceMs),
        ),
      ),
    )
    .returning({ serverId: serverChecks.serverId });
  for (const serverId of new Set(recovered.map((check) => check.serverId)))
    await pruneServerCheckHistory(database, serverId);
  return recovered.length;
}
