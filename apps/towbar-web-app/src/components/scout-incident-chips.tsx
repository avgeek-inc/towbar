import { Chip } from "@workspace/web-design-system/data-display/chip";
import type { ScoutIncident } from "./scout-controls";
import { formatDate } from "./dashboard-overview";
import { ScoutIcon } from "./scout-icons";

type IncidentChipData = Pick<
  ScoutIncident,
  "openedAt" | "resolvedAt" | "resolutionReason" | "severity"
>;

export function ScoutIncidentStateChip({
  incident,
}: {
  incident: IncidentChipData;
}) {
  const recovered = incident.resolutionReason === "recovered";
  const tooltip = incident.resolvedAt
    ? `${recovered ? "The triggering condition cleared" : "The incident was closed"} ${formatDate(incident.resolvedAt)}.`
    : `The triggering condition has remained active since ${formatDate(incident.openedAt)}.`;

  return (
    <Chip
      size="small"
      tooltip={tooltip}
      icon={
        <ScoutIcon
          name={
            incident.resolvedAt ? (recovered ? "resolved" : "close") : "active"
          }
        />
      }
      variant={
        incident.resolvedAt
          ? recovered
            ? "success"
            : "secondary"
          : "destructive"
      }
    >
      {incident.resolvedAt ? (recovered ? "Recovered" : "Closed") : "Active"}
    </Chip>
  );
}

export function ScoutIncidentSeverityChip({
  severity,
}: {
  severity: IncidentChipData["severity"];
}) {
  const critical = severity === "critical";

  return (
    <Chip
      size="small"
      tooltip={
        critical
          ? "Critical incidents represent high-impact threshold breaches."
          : "Warning incidents need attention but are not classified as critical."
      }
      icon={<ScoutIcon name={critical ? "critical" : "warning"} />}
      variant={critical ? "destructive" : "warning"}
    >
      {critical ? "Critical" : "Warning"}
    </Chip>
  );
}
