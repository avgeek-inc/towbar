import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { deployments } from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { getMonitoringHistory } from "./queries.js";

export async function verifyEventHistoryBounds(
  serverId: string,
  workspaceId: string,
  now: Date,
) {
  const db = getTowbarDatabase();
  const [template] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.serverId, serverId))
    .limit(1);
  assert(template);
  const row = (createdAt: Date) => {
    const id = randomUUID();
    return {
      ...template,
      id,
      idempotencyKey: id,
      temporalWorkflowId: id,
      createdAt,
    };
  };
  const old = row(new Date(now.getTime() - 2 * 3600_000));
  const future = row(new Date(now.getTime() + 3600_000));
  await db.insert(deployments).values([old, future]);
  const query = { serverId, workspaceId, environment: "production" as const };
  const hour = await getMonitoringHistory({ ...query, range: "1h" }, now);
  assert(
    !hour.events.some((event) => event.id === old.id || event.id === future.id),
  );
  const sixHours = await getMonitoringHistory({ ...query, range: "6h" }, now);
  assert(sixHours.events.some((event) => event.id === old.id));
  assert(!sixHours.events.some((event) => event.id === future.id));
  await db
    .insert(deployments)
    .values(
      Array.from({ length: 203 }, (_, i) =>
        row(new Date(now.getTime() - 60_000 - i * 1000)),
      ),
    );
  const capped = await getMonitoringHistory({ ...query, range: "1h" }, now);
  assert.equal(capped.events.length, 200);
  assert.equal(capped.eventsLimited, true);
  assert(
    capped.events.every(
      (event) => event.at >= capped.startAt && event.at < capped.endAt,
    ),
  );
  assert.deepEqual(
    capped.events.map((event) => event.at),
    capped.events
      .map((event) => event.at)
      .sort()
      .reverse(),
  );
  const custom = await getMonitoringHistory(
    {
      ...query,
      range: "custom",
      startAt: new Date(now.getTime() - 3 * 3600000).toISOString(),
      endAt: new Date(now.getTime() - 3600000).toISOString(),
    },
    now,
  );
  assert(custom.events.some((event) => event.id === old.id));
  assert(
    custom.events.every(
      (event) => event.at >= custom.startAt && event.at < custom.endAt,
    ),
  );
  assert.equal(custom.eventsLimited, false);
  await assert.rejects(
    getMonitoringHistory(
      {
        ...query,
        range: "custom",
        startAt: now.toISOString(),
        endAt: future.createdAt.toISOString(),
      },
      now,
    ),
    /future/,
  );
  const short = await getMonitoringHistory({ ...query, range: "15m" }, now);
  assert(!short.events.some((event) => event.id === old.id));
  const repeated = await getMonitoringHistory({ ...query, range: "1h" }, now);
  assert.deepEqual(repeated.events, capped.events);
}
