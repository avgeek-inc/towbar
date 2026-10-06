import { TooltipText } from "@avgeek-oss/design-system/overlays/tooltip";
import { Chip } from "@avgeek-oss/design-system/data-display/chip";
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
    <TooltipText className="inline-flex" tooltip={tooltip}>
      <Chip
        size="sm"
        color={
          incident.resolvedAt ? (recovered ? "success" : "default") : "danger"
        }
      >
        <Chip.Label className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5">
          {
            <ScoutIcon
              name={
                incident.resolvedAt
                  ? recovered
                    ? "resolved"
                    : "close"
                  : "active"
              }
            />
          }
          {incident.resolvedAt
            ? recovered
              ? "Recovered"
              : "Closed"
            : "Active"}
        </Chip.Label>
      </Chip>
    </TooltipText>
  );
}

export function ScoutIncidentSeverityChip({
  severity,
}: {
  severity: IncidentChipData["severity"];
}) {
  const critical = severity === "critical";

  return (
    <TooltipText
      className="inline-flex"
      tooltip={
        critical
          ? "Critical incidents represent high-impact threshold breaches."
          : "Warning incidents need attention but are not classified as critical."
      }
    >
      <Chip size="sm" color={critical ? "danger" : "warning"}>
        <Chip.Label className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5">
          {<ScoutIcon name={critical ? "critical" : "warning"} />}
          {critical ? "Critical" : "Warning"}
        </Chip.Label>
      </Chip>
    </TooltipText>
  );
}
