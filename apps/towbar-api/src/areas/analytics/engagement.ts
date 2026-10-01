import type { AnalyticsConfig } from "@workspace/towbar-core";
import { type SQL, sql } from "drizzle-orm";
import type { AuthDatabase } from "../../infrastructure/database.js";

export async function getPageEngagement(
  database: AuthDatabase,
  input: {
    appId: string;
    start: Date;
    end: Date;
    retentionDays: number;
    identity: boolean;
    retentionEnd?: Date;
    conditions: SQL;
  },
) {
  const { appId, start, end, conditions } = input;
  const retainedStart = new Date(
    (input.retentionEnd ?? end).getTime() - input.retentionDays * 86400000,
  );
  const scope = sql`s.app_id=${appId}::uuid and s.collected_at >= ${retainedStart.toISOString()}::timestamptz and s.collected_at < ${end.toISOString()}::timestamptz`;
  const selected = sql`select c from towbar_analytics_samples s
    cross join lateral jsonb_array_elements(s.cells) c
    where ${scope} and s.collected_at >= ${start.toISOString()}::timestamptz
      and c->>'kind'='pageview' and ${conditions}`;
  const [time] = await database.execute<{
    pages: string;
    duration: string;
  }>(sql`
    with selected as (${selected}), page_times as (
      select c->>'pageId' id, max((c->>'visibleMs')::bigint) duration
      from towbar_analytics_samples s cross join lateral jsonb_array_elements(s.cells) c
      where ${scope} and c->>'kind'='engagement'
        and c->>'pageId' in (select c->>'pageId' from selected)
      group by 1
    ) select count(*)::text pages, coalesce(sum(coalesce(t.duration,0)),0)::text duration
      from selected p left join page_times t on t.id=p.c->>'pageId'
      where p.c->>'pageId' is not null`);
  const outbound = await database.execute<{
    value: string;
    count: string;
    total: string;
  }>(sql`
    select c->>'destination' value, sum((c->>'count')::bigint)::text count, sum(sum((c->>'count')::bigint)) over()::text total
    from towbar_analytics_samples s cross join lateral jsonb_array_elements(s.cells) c
    where ${scope} and s.collected_at >= ${start.toISOString()}::timestamptz
      and c->>'kind'='outbound' and ${conditions}
    group by 1 order by sum((c->>'count')::bigint) desc,1 limit 25`);
  const averageTimeMs =
    time && Number(time.pages)
      ? Number(time.duration) / Number(time.pages)
      : null;
  const outboundLinks = outbound.map((row) => ({
    value: row.value,
    count: Number(row.count),
  }));
  if (!input.identity)
    return {
      averageTimeMs,
      bounceRate: null,
      exits: 0,
      outboundClicks: Number(outbound[0]?.total ?? 0),
      exitPages: [],
      outboundLinks,
    };

  // Select visits using the filters, then count all of their pages. Filtering a
  // multi-page visit down to one page must not turn it into a bounce.
  const visits = sql`with selected as (${selected}), events as (
    select c, s.collected_at at from towbar_analytics_samples s
    cross join lateral jsonb_array_elements(s.cells) c where ${scope}
      and c->>'kind' in ('pageview','engagement')
      and nullif(c->>'session','') in (select nullif(c->>'session','') from selected)
  ), completed as (
    select c->>'session' session, sum((c->>'count')::bigint) filter(where c->>'kind'='pageview') pages,
      bool_and(c->>'pageStartedAt' is not null) filter(where c->>'kind'='pageview') ordered
    from events group by 1 having max(at) < ${new Date(end.getTime() - 1800000).toISOString()}::timestamptz
      and min(at) >= ${start.toISOString()}::timestamptz
  )`;
  const [bounce] = await database.execute<{
    visits: string;
    bounces: string;
  }>(sql`
    ${visits} select count(*)::text visits, count(*) filter(where pages=1)::text bounces from completed`);
  const exits = await database.execute<{
    value: string;
    count: string;
    total: string;
  }>(sql`
    ${visits}, ranked as (
      select c, row_number() over(partition by c->>'session'
        order by coalesce((c->>'pageStartedAt')::timestamptz,at) desc, at desc, c->>'pageId' desc) rank
      from events where c->>'kind'='pageview' and c->>'session' in (select session from completed where ordered)
    ) select c->>'path' value, count(*)::text count, sum(count(*)) over()::text total from ranked where rank=1 and ${conditions}
      group by 1 order by count(*) desc,1 limit 25`);
  return {
    averageTimeMs,
    bounceRate:
      bounce && Number(bounce.visits)
        ? (Number(bounce.bounces) / Number(bounce.visits)) * 100
        : null,
    exits: Number(exits[0]?.total ?? 0),
    outboundClicks: Number(outbound[0]?.total ?? 0),
    exitPages: exits.map((row) => ({
      value: row.value,
      count: Number(row.count),
    })),
    outboundLinks,
  };
}

export async function getAnalyticsEngagement(
  database: AuthDatabase,
  input: {
    appId: string;
    kind: "request" | "pageview";
    config: AnalyticsConfig | null;
    available?: boolean;
    start: Date;
    end: Date;
    retentionEnd?: Date;
    conditions: SQL;
  },
) {
  if (input.available === false || input.kind !== "pageview" || !input.config)
    return {
      bounceRate: null,
      averageTimeMs: null,
      exits: 0,
      outboundClicks: 0,
      exitPages: [],
      outboundLinks: [],
    };
  return getPageEngagement(database, {
    ...input,
    retentionDays: input.config.retentionDays,
    identity: input.config.visitorIdentity,
  });
}
