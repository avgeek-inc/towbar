import { sql } from "drizzle-orm";
import { getTowbarDatabase } from "../../infrastructure/database.js";

/** Incident history follows the server's Scout retention; active incidents stay visible. */
export async function maintainScoutAlertHistory(now = new Date()) {
  const db = getTowbarDatabase();
  let incidents = 0,
    events = 0,
    rules = 0;
  for (let batch = 0; batch < 4; batch++) {
    const result = await db.execute(sql`
      with doomed as (
        select i.id from towbar_scout_alert_incidents i
        left join towbar_monitoring_agents a on a.server_id=i.server_id
        where i.resolved_at < ${now.toISOString()}::timestamptz-coalesce(a.retention_days,15)*interval '1 day'
        order by i.resolved_at limit 2000
      ) delete from towbar_scout_alert_incidents where id in(select id from doomed)`);
    incidents += result.count;
    if (result.count < 2000) break;
  }
  for (let batch = 0; batch < 4; batch++) {
    const result = await db.execute(sql`
      with doomed as (
        select e.id from towbar_notification_events e
        left join towbar_monitoring_agents a on a.server_id=e.server_id
        where e.category='scout' and e.occurred_at < ${now.toISOString()}::timestamptz-coalesce(a.retention_days,15)*interval '1 day'
        order by e.occurred_at limit 2000
      ) delete from towbar_notification_events where id in(select id from doomed)`);
    events += result.count;
    if (result.count < 2000) break;
  }
  const result = await db.execute(sql`
    with doomed as (
      select r.id from towbar_scout_alert_rules r
      where r.deleted_at < ${now.toISOString()}::timestamptz-interval '60 days'
        and not exists(select 1 from towbar_scout_alert_incidents i where i.rule_id=r.id)
      limit 2000
    ) delete from towbar_scout_alert_rules where id in(select id from doomed)`);
  rules += result.count;
  return { incidents, events, rules };
}
