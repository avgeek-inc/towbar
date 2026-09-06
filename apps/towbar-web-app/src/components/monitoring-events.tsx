import type { MonitoringHistory } from "@workspace/towbar-web-client";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { formatDate } from "./dashboard-overview";

type Event = MonitoringHistory["events"][number];
const columns: ResourceTableColumn<Event>[] = [
  {
    key: "event",
    header: "Event",
    cell: (event) =>
      event.type === "deployment" ? "Deployment" : "Container restart",
  },
  {
    key: "reference",
    header: "Reference",
    cell: (event) => <TypographyCode>{event.id.slice(0, 8)}</TypographyCode>,
  },
  {
    key: "status",
    header: "Status",
    cell: (event) =>
      event.type === "deployment" ? (
        <StatusBadge status={event.state} />
      ) : (
        "Restarted"
      ),
  },
  {
    key: "time",
    header: "Time",
    cell: (event) => <time dateTime={event.at}>{formatDate(event.at)}</time>,
  },
];

export function MonitoringEvents({ events }: { events: Event[] }) {
  return (
    <section
      className="grid min-w-0 gap-3"
      aria-label="Deployment and restart events"
    >
      <h3 className="font-medium">Deployment and restart events</h3>
      <div className="max-h-96 overflow-auto">
        <ResourceTable
          ariaLabel="Deployment and restart events"
          columns={columns}
          items={events}
          getRowKey={(event) => `${event.type}:${event.id}:${event.at}`}
          emptyTitle="No events in this range"
          emptyDescription="Deployments and container restarts will appear here."
          tableClassName="min-w-[580px]"
        />
      </div>
    </section>
  );
}

export const monitoringEventColor = (type: Event["type"]) =>
  type === "deployment" ? "var(--accent)" : "var(--warning)";

export function MonitoringEventMarker({
  event,
  viewBox,
}: {
  event: Event;
  viewBox?: { x?: number; y?: number };
}) {
  if (viewBox?.x === undefined || viewBox.y === undefined) return null;
  const offset = event.type === "deployment" ? 9 : 25;
  const label = `${event.type === "deployment" ? "Deployment" : "Container restart"} ${event.id.slice(0, 8)} at ${formatDate(event.at)}`;
  return (
    <g aria-label={label} role="img" className="monitoring-event-marker">
      <title>{label}</title>
      <circle
        cx={viewBox.x}
        cy={viewBox.y + offset}
        r={7}
        fill={monitoringEventColor(event.type)}
      />
      <text
        x={viewBox.x}
        y={viewBox.y + offset + 3}
        textAnchor="middle"
        fill="var(--accent-foreground)"
        fontSize={9}
        fontWeight={600}
      >
        {event.type === "deployment" ? "D" : "R"}
      </text>
    </g>
  );
}
