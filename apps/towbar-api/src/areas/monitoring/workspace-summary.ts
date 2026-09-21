import { sql } from "drizzle-orm";
import { getTowbarDatabase } from "../../infrastructure/database.js";

export async function getWorkspaceMonitoringSummary(workspaceId: string) {
  const [row] = await getTowbarDatabase().execute<{
    active_incidents: number;
    critical_vulnerabilities: number;
  }>(sql`
    WITH scoped_servers AS (
      SELECT id FROM towbar_servers
      WHERE workspace_id = ${workspaceId}::uuid AND archived_at IS NULL
    )
    SELECT
      (SELECT count(*)::int FROM towbar_scout_alert_incidents i
        JOIN scoped_servers s ON s.id = i.server_id
        WHERE i.workspace_id = ${workspaceId}::uuid AND i.resolved_at IS NULL) AS active_incidents,
      (SELECT coalesce(sum(
        (latest_scan.severity_totals->>'critical')::int +
        (latest_scan.severity_totals->>'high')::int), 0)::int
        FROM (
          SELECT DISTINCT ON (v.app_id) v.server_id, v.severity_totals
          FROM towbar_image_vulnerability_scans v
          WHERE v.workspace_id = ${workspaceId}::uuid
          ORDER BY v.app_id, v.requested_at DESC, v.id DESC
        ) latest_scan
        JOIN scoped_servers s ON s.id = latest_scan.server_id) AS critical_vulnerabilities
  `);
  return {
    activeIncidents: row?.active_incidents ?? 0,
    criticalVulnerabilities: row?.critical_vulnerabilities ?? 0,
  };
}
