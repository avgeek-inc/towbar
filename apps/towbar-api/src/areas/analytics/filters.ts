import { type SQL, and, sql } from "drizzle-orm";
import {
  type AnalyticsFilter,
  analyticsResponseTimeRanges,
} from "@workspace/towbar-core";

export function analyticsDimension(field: string): SQL {
  if (field === "city")
    return sql`case when coalesce(c->>'city', '') = '' then 'Unknown'
      else concat_ws(', ', c->>'city', nullif(c->>'region', ''), nullif(c->>'country', '')) end`;
  return sql`coalesce(nullif(c->>${field}, ''), 'Unknown')`;
}

export function analyticsConditions(
  filters: AnalyticsFilter[],
  scope: {
    appId: string;
    start: Date;
    end: Date;
  },
): SQL {
  return (
    and(
      ...filters
        .filter((filter) => filter.field !== "responseTime")
        .map(({ field, operator, value }) => {
          const expression =
            field === "path" ? sql`c->>'path'` : analyticsDimension(field);
          if (field === "destination" && Array.isArray(value)) {
            const choices = sql.join(
              value.map((item) => sql`${item}`),
              sql`, `,
            );
            return sql`case when c->>'kind'='outbound' then c->>'destination' in (${choices})
        else exists (
          select 1 from towbar_analytics_samples outbound_sample
          cross join lateral jsonb_array_elements(outbound_sample.cells) outbound_cell
          where outbound_sample.app_id=${scope.appId}::uuid
            and outbound_sample.collected_at>=${scope.start.toISOString()}::timestamptz
            and outbound_sample.collected_at<${scope.end.toISOString()}::timestamptz
            and outbound_cell->>'kind'='outbound'
            and outbound_cell->>'pageId'=c->>'pageId'
            and outbound_cell->>'destination' in (${choices})
        ) end`;
          }
          if (operator === "in" && Array.isArray(value))
            return sql`${expression} in (${sql.join(
              value.map((item) => sql`${item}`),
              sql`, `,
            )})`;
          if (operator === "startsWith" && typeof value === "string")
            return sql`left(${expression}, length(${value}::text)) = ${value}`;
          return sql`${expression} = ${value as string}`;
        }),
    ) ?? sql`true`
  );
}

// Older agents aggregate requests across latency ranges. Select their histogram
// counts exactly; bytes and duration cannot be split without per-range totals.
export function analyticsCells(filters: AnalyticsFilter[]): SQL {
  const ranges = filters.filter((filter) => filter.field === "responseTime");
  if (!ranges.length) return sql`jsonb_array_elements(s.cells) c`;
  const indexes = analyticsResponseTimeRanges.flatMap((range, index) =>
    ranges.every(
      (filter) => Array.isArray(filter.value) && filter.value.includes(range),
    )
      ? [index + 1]
      : [],
  );
  const selected = indexes.length
    ? sql`h.ordinality in (${sql.join(
        indexes.map((index) => sql`${index}`),
        sql`, `,
      )})`
    : sql`false`;
  return sql`jsonb_array_elements(s.cells) raw_cell
    cross join lateral (
      select coalesce(sum(h.value::text::bigint) filter(where ${selected}),0) count,
        jsonb_agg(case when ${selected} then h.value else '0'::jsonb end order by h.ordinality) histogram
      from jsonb_array_elements(raw_cell->'histogram') with ordinality h(value,ordinality)
    ) latency
    cross join lateral (
      select raw_cell || jsonb_build_object('count',latency.count,'histogram',latency.histogram,
        'bytes',case when latency.count=(raw_cell->>'count')::bigint then raw_cell->'bytes' else 'null'::jsonb end,
        'durationMs',case when latency.count=(raw_cell->>'count')::bigint then raw_cell->'durationMs' else 'null'::jsonb end) c
      where latency.count>0
    ) selected_cell`;
}
