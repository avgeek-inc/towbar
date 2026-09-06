import type {
  scoutAlertIncidents,
  scoutAlertRules,
  scoutAlertSettings,
} from "@workspace/towbar-database/schema";

export function scoutNotificationsPaused(
  rule: typeof scoutAlertRules.$inferSelect,
  settings: typeof scoutAlertSettings.$inferSelect | null,
  now: Date,
) {
  return (
    !rule.enabled ||
    rule.deletedAt !== null ||
    Boolean(rule.mutedUntil && rule.mutedUntil > now) ||
    Boolean(settings?.mutedUntil && settings.mutedUntil > now)
  );
}

export function scoutIncidentChanged(
  rule: typeof scoutAlertRules.$inferSelect,
  incident: typeof scoutAlertIncidents.$inferSelect,
  environment: unknown,
) {
  return (
    JSON.stringify(rule.condition) !== JSON.stringify(incident.condition) ||
    rule.deployableId !== incident.deployableId ||
    (typeof environment === "string" && rule.environment !== environment)
  );
}
