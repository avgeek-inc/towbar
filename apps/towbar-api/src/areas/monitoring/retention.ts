import { and, asc, eq, lt, sql } from "drizzle-orm";
import type { MonitoringAggregates } from "@workspace/towbar-core";
import {
  monitoringAgents,
  monitoringBatches,
  monitoringSamples,
} from "@workspace/towbar-database/schema";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export function mergeMonitoringAggregates(
  left: MonitoringAggregates,
  right: MonitoringAggregates,
): MonitoringAggregates {
  const result: MonitoringAggregates = { ...left };
  for (const [name, value] of Object.entries(right)) {
    const key = name as keyof MonitoringAggregates;
    const old = result[key];
    result[key] = old
      ? {
          sum: old.sum + value.sum,
          count: old.count + value.count,
          min: Math.min(old.min, value.min),
          max: Math.max(old.max, value.max),
        }
      : { ...value };
  }
  return result;
}

export async function maintainMonitoringMetrics(now = new Date()) {
  const database = getTowbarDatabase();
  const rawCutoff = new Date(now.getTime() - 86400_000);
  let compacted = 0;
  // Bounded chunks avoid unbounded transactions and keep maintenance responsive.
  for (let batch = 0; batch < 8; batch++) {
    const count = await database.transaction(async (transaction) => {
      const raw = await transaction
        .select()
        .from(monitoringSamples)
        .where(
          and(
            eq(monitoringSamples.resolution, 30),
            lt(monitoringSamples.bucketAt, rawCutoff),
          ),
        )
        .orderBy(asc(monitoringSamples.bucketAt))
        .limit(5000)
        .for("update", { skipLocked: true });
      if (raw.length === 0) return 0;
      const groups = new Map<string, (typeof raw)[number]>();
      for (const row of raw) {
        const minute = new Date(
          Math.floor(row.bucketAt.getTime() / 60_000) * 60_000,
        );
        const key = `${row.serverId}:${row.entityId}:${minute.toISOString()}`;
        const old = groups.get(key);
        groups.set(key, {
          ...row,
          bucketAt: minute,
          resolution: 60,
          metrics: mergeMonitoringAggregates(old?.metrics ?? {}, row.metrics),
        });
      }
      await transaction
        .insert(monitoringSamples)
        .values(
          [...groups.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([, value]) => value),
        )
        .onConflictDoUpdate({
          target: [
            monitoringSamples.serverId,
            monitoringSamples.entityId,
            monitoringSamples.bucketAt,
            monitoringSamples.resolution,
          ],
          set: {
            metrics: sql`towbar_merge_monitoring_metrics(${monitoringSamples.metrics}, excluded.metrics)`,
            state: sql`excluded.state`,
            health: sql`excluded.health`,
            deploymentId: sql`excluded.deployment_id`,
            previewId: sql`excluded.preview_id`,
          },
        });
      // Exact locked source rows are removed in the same transaction as the rollup.
      const keys = sql.join(
        raw.map(
          (row) =>
            sql`(${row.serverId}::uuid,${row.entityId},${row.bucketAt.toISOString()}::timestamptz)`,
        ),
        sql`, `,
      );
      await transaction
        .delete(monitoringSamples)
        .where(
          sql`${monitoringSamples.resolution}=30 and (${monitoringSamples.serverId},${monitoringSamples.entityId},${monitoringSamples.bucketAt}) in (${keys})`,
        );
      return raw.length;
    });
    compacted += count;
    if (count < 5000) break;
  }
  // Retention is per server, including disabled agents. Archived servers retain history only until expiry.
  const settings = await database
    .select({
      serverId: monitoringAgents.serverId,
      days: monitoringAgents.retentionDays,
    })
    .from(monitoringAgents);
  let expired = 0;
  for (const setting of settings) {
    const cutoff = new Date(now.getTime() - setting.days * 86400_000);
    // Index-backed chunks avoid one large delete when retention is shortened.
    for (let batch = 0; batch < 4; batch++) {
      const result = await database.execute(sql`
        with doomed as (select ctid from towbar_monitoring_samples where server_id=${setting.serverId}::uuid and bucket_at<${cutoff.toISOString()}::timestamptz limit 10000)
        delete from towbar_monitoring_samples where ctid in (select ctid from doomed)`);
      expired += result.count;
      if (result.count < 10000) break;
    }
  }
  await database
    .delete(monitoringBatches)
    .where(
      lt(monitoringBatches.receivedAt, new Date(now.getTime() - 3 * 3600_000)),
    );
  return { compacted, expired };
}
