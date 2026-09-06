import { sql } from "drizzle-orm";
import type { ServerMonitoringSummary } from "@workspace/towbar-core";
import { getTowbarDatabase } from "../../infrastructure/database.js";

/** One scoped query, at most 60 host samples per enabled server. */
export async function getServerMonitoringSummaries(
  workspaceId: string,
  now = new Date(),
): Promise<Map<string, ServerMonitoringSummary>> {
  const end = now.toISOString();
  const freshSince = new Date(now.getTime() - 90_000).toISOString();
  const start = new Date(now.getTime() - 30 * 60_000).toISOString();
  const rows = await getTowbarDatabase().execute<{
    id: string;
    status: string;
    desired_state: string;
    last_collected_at: string | null;
    points: ServerMonitoringSummary["points"];
  }>(sql`
    SELECT s.id, coalesce(a.status, 'disabled') AS status,
      coalesce(a.desired_state, 'disabled') AS desired_state,
      a.last_collected_at::text,
      coalesce(history.points, '[]'::json) AS points
    FROM towbar_servers s
    LEFT JOIN towbar_monitoring_agents a ON a.server_id = s.id
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'at', samples.bucket_at,
        'cpuPercent', (samples.metrics->'cpuPercent'->>'sum')::double precision /
          nullif((samples.metrics->'cpuPercent'->>'count')::double precision, 0),
        'memoryPercent', (samples.metrics->'memoryPercent'->>'sum')::double precision /
          nullif((samples.metrics->'memoryPercent'->>'count')::double precision, 0)
      ) ORDER BY samples.bucket_at) AS points
      FROM (
        SELECT bucket_at, metrics FROM towbar_monitoring_samples
        WHERE server_id = s.id AND entity_id = 'host' AND resolution = 30
          AND bucket_at > ${start}::timestamptz AND bucket_at <= ${end}::timestamptz
          AND a.desired_state = 'enabled' AND a.status = 'online'
          AND a.last_collected_at >= ${freshSince}::timestamptz
        ORDER BY bucket_at DESC LIMIT 60
      ) samples
    ) history ON true
    WHERE s.workspace_id = ${workspaceId}::uuid AND s.archived_at IS NULL
  `);
  return new Map(
    rows.map((row) => {
      const lastCollectedAt = row.last_collected_at
        ? new Date(row.last_collected_at).toISOString()
        : null;
      const stale =
        row.status === "online" &&
        (!lastCollectedAt ||
          now.getTime() - Date.parse(lastCollectedAt) > 90_000);
      return [
        row.id,
        {
          status: stale ? "offline" : row.status,
          enabled: row.desired_state === "enabled",
          lastCollectedAt,
          start,
          end,
          points: row.points,
        },
      ];
    }),
  );
}
