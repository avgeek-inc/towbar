import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { scoutAlertConditionSchema } from "@workspace/towbar-core";
import {
  scoutAlertRules,
  scoutHttpChecks,
  servers,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";
import { probePublicHttp } from "./http-probe.js";

/** At most four concurrent probes and twenty attempts per sweep; 25 seconds to start work, 10 seconds per probe; claims survive API/worker restarts. */
export async function collectScoutHttpChecks(
  now = new Date(),
  probe = probePublicHttp,
) {
  const started = Date.now();
  const db = getTowbarDatabase();
  const candidates = await db
    .select({ rule: scoutAlertRules })
    .from(scoutAlertRules)
    .innerJoin(
      servers,
      and(
        eq(servers.id, scoutAlertRules.serverId),
        eq(servers.workspaceId, scoutAlertRules.workspaceId),
        isNull(servers.archivedAt),
      ),
    )
    .where(
      and(
        eq(scoutAlertRules.enabled, true),
        isNull(scoutAlertRules.deletedAt),
        sql`${scoutAlertRules.condition}->>'metric'='httpAvailability'`,
        // Skip already-claimed slots before limiting the batch. Otherwise old
        // five-minute checks can starve newer thirty-second checks.
        sql`not exists (
          select 1 from towbar_scout_http_checks c
          where c.rule_id=${scoutAlertRules.id} and c.scheduled_at=to_timestamp(
            floor(extract(epoch from ${now.toISOString()}::timestamptz) /
              nullif((${scoutAlertRules.condition}->'http'->>'intervalSeconds')::integer,0)) *
              (${scoutAlertRules.condition}->'http'->>'intervalSeconds')::integer
          )
        )`,
      ),
    )
    .orderBy(
      sql`(select max(c.scheduled_at) from towbar_scout_http_checks c where c.rule_id=${scoutAlertRules.id}) asc nulls first`,
      asc(scoutAlertRules.id),
    )
    .limit(20);
  const deadline = Date.now() + 25_000;
  let claimed = 0,
    blocked = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (candidates.length && Date.now() < deadline) {
        const candidate = candidates.shift()!.rule;
        const parsed = scoutAlertConditionSchema.safeParse(candidate.condition);
        if (!parsed.success || !parsed.data.http) continue;
        const check = parsed.data.http;
        const scheduledAt = new Date(
          Math.floor(now.getTime() / (check.intervalSeconds * 1000)) *
            check.intervalSeconds *
            1000,
        );
        const inserted = await db
          .insert(scoutHttpChecks)
          .values({
            ruleId: candidate.id,
            scheduledAt,
            ruleRevision: candidate.updatedAt,
          })
          .onConflictDoNothing()
          .returning({ ruleId: scoutHttpChecks.ruleId });
        if (!inserted.length) continue;
        // Verify configuration again after reserving, without holding a DB lock during network I/O.
        const [current] = await db
          .select({ id: scoutAlertRules.id })
          .from(scoutAlertRules)
          .where(
            and(
              eq(scoutAlertRules.id, candidate.id),
              eq(scoutAlertRules.enabled, true),
              isNull(scoutAlertRules.deletedAt),
              sql`date_trunc('milliseconds',${scoutAlertRules.updatedAt})=${candidate.updatedAt.toISOString()}::timestamptz`,
              eq(scoutAlertRules.condition, candidate.condition),
            ),
          )
          .limit(1);
        if (!current) continue;
        claimed++;
        const result = await probe(check);
        if (result.state === "blocked") blocked++;
        await db
          .update(scoutHttpChecks)
          .set({
            ...result,
            checkedAt: new Date(now.getTime() + Date.now() - started),
          })
          .where(
            and(
              eq(scoutHttpChecks.ruleId, candidate.id),
              eq(scoutHttpChecks.scheduledAt, scheduledAt),
            ),
          );
      }
    }),
  );
  return { checked: claimed, blocked };
}
