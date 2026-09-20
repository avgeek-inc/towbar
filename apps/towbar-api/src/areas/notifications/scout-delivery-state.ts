import type {
  scoutAlertIncidents,
  scoutAlertRules,
} from "@workspace/towbar-database/schema";

export function scoutRuleDisabled(rule: typeof scoutAlertRules.$inferSelect) {
  return !rule.enabled || rule.deletedAt !== null;
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
