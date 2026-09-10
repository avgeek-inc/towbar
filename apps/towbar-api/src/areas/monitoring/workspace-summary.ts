import { sql } from "drizzle-orm";
import { getTowbarDatabase } from "../../infrastructure/database.js";

/** Count current pressure, not historical peaks or configured alert rules. */
export async function getWorkspaceMonitoringSummary(
  workspaceId: string,
  now = new Date(),
) {
  const freshSince = new Date(now.getTime() - 90_000).toISOString();
  const [row] = await getTowbarDatabase().execute<{
    active_incidents: number;
    critical_vulnerabilities: number;
    pressured_entities: number;
  }>(sql`
    WITH scoped_servers AS (
      SELECT id FROM towbar_servers
      WHERE workspace_id = ${workspaceId}::uuid AND archived_at IS NULL
    ), latest AS (
      SELECT DISTINCT ON (m.server_id, m.entity_id)
        m.server_id, m.entity_id, m.deployable_id, m.state, m.metrics
      FROM scoped_servers s
      JOIN towbar_monitoring_agents a ON a.server_id = s.id
      JOIN towbar_monitoring_samples m ON m.server_id = s.id
      WHERE a.desired_state = 'enabled' AND a.status = 'online'
        AND a.last_collected_at >= ${freshSince}::timestamptz
        AND m.resolution = 30
        AND m.bucket_at >= ${freshSince}::timestamptz
        AND m.bucket_at <= ${now.toISOString()}::timestamptz
      ORDER BY m.server_id, m.entity_id, m.bucket_at DESC
    ), pressured AS (
      SELECT DISTINCT CASE WHEN m.entity_id = 'host'
        THEN 'server:' || m.server_id::text
        ELSE 'workload:' || m.deployable_id::text END AS entity
      FROM latest m
      LEFT JOIN towbar_apps app ON app.id = m.deployable_id
        AND app.workspace_id = ${workspaceId}::uuid
        AND app.server_id = m.server_id AND app.archived_at IS NULL
      WHERE (m.entity_id = 'host' OR (app.id IS NOT NULL AND m.state = 'running'))
        AND EXISTS (
          SELECT 1 FROM jsonb_each(m.metrics) metric
          WHERE metric.key IN ('cpuPercent', 'memoryPercent', 'diskPercent', 'dockerDiskPercent')
            AND (metric.value->>'sum')::double precision /
              nullif((metric.value->>'count')::double precision, 0) > 80
        )
    )
    SELECT
      (SELECT count(*)::int FROM towbar_scout_alert_incidents i
        JOIN scoped_servers s ON s.id = i.server_id
        WHERE i.workspace_id = ${workspaceId}::uuid AND i.resolved_at IS NULL) AS active_incidents,
      (SELECT coalesce(sum(
        (latest_scan.severity_totals->>'critical')::int +
        (latest_scan.severity_totals->>'high')::int), 0)::int
        FROM (
          SELECT DISTINCT ON (v.app_id) v.severity_totals
          FROM towbar_image_vulnerability_scans v
          WHERE v.workspace_id = ${workspaceId}::uuid
          ORDER BY v.app_id, v.requested_at DESC
        ) latest_scan) AS critical_vulnerabilities,
      (SELECT count(*)::int FROM pressured) AS pressured_entities
  `);
  return {
    activeIncidents: row?.active_incidents ?? 0,
    criticalVulnerabilities: row?.critical_vulnerabilities ?? 0,
    pressuredEntities: row?.pressured_entities ?? 0,
  };
}
