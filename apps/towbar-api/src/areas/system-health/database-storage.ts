import { asc, sql } from "drizzle-orm";

import { databaseStorageSamples } from "@workspace/towbar-database/schema";

import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function recordDatabaseStorageSample() {
  const database = getTowbarDatabase();
  const [size] = await database.execute<{
    towbarBytes: string;
    monitoringBytes: string;
    analyticsBytes: string;
  }>(sql`
    select
      coalesce(sum(pg_total_relation_size(c.oid)) filter (
        where left(c.relname, length('towbar_monitoring_')) <> 'towbar_monitoring_'
          and left(c.relname, length('towbar_scout_')) <> 'towbar_scout_'
          and left(c.relname, length('towbar_analytics_')) <> 'towbar_analytics_'
      ), 0)::text as "towbarBytes",
      coalesce(sum(pg_total_relation_size(c.oid)) filter (
        where left(c.relname, length('towbar_monitoring_')) = 'towbar_monitoring_'
          or left(c.relname, length('towbar_scout_')) = 'towbar_scout_'
      ), 0)::text as "monitoringBytes",
      coalesce(sum(pg_total_relation_size(c.oid)) filter (
        where left(c.relname, length('towbar_analytics_')) = 'towbar_analytics_'
      ), 0)::text as "analyticsBytes"
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = current_schema()
      and c.relkind in ('r', 'p')
      and left(c.relname, length('towbar_')) = 'towbar_'
  `);
  if (!size) throw new Error("Could not read the Towbar table sizes");
  const towbarBytes = Number(size.towbarBytes);
  const monitoringBytes = Number(size.monitoringBytes);
  const analyticsBytes = Number(size.analyticsBytes);
  if (
    !Number.isSafeInteger(towbarBytes) ||
    !Number.isSafeInteger(monitoringBytes) ||
    !Number.isSafeInteger(analyticsBytes)
  )
    throw new Error("Towbar database size exceeds the supported range");

  const [sample] = await database
    .insert(databaseStorageSamples)
    .values({ towbarBytes, monitoringBytes, analyticsBytes })
    .returning();
  await database
    .delete(databaseStorageSamples)
    .where(
      sql`${databaseStorageSamples.sampledAt} < now() - interval '90 days'`,
    );
  return sample;
}

export async function getDatabaseStorage() {
  const samples = await getTowbarDatabase()
    .select()
    .from(databaseStorageSamples)
    .where(
      sql`${databaseStorageSamples.sampledAt} >= now() - interval '90 days'`,
    )
    .orderBy(asc(databaseStorageSamples.sampledAt));
  return samples.map((sample) => ({
    sampledAt: sample.sampledAt.toISOString(),
    towbarBytes: sample.towbarBytes,
    monitoringBytes: sample.monitoringBytes,
    analyticsBytes: sample.analyticsBytes,
  }));
}
