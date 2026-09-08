import { memo, useEffect, useMemo, useState } from "react";
import { Tooltip } from "@workspace/web-design-system/overlays/tooltip";
import type { MonitoringHistory } from "@workspace/towbar-web-client";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
const eventDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const eventTooltipDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "long",
});
const formatDate = (at: string) => eventDateFormatter.format(new Date(at));

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
        <StatusBadge status="restarted" />
      ),
  },
  {
    key: "time",
    header: "Time",
    cell: (event) => <time dateTime={event.at}>{formatDate(event.at)}</time>,
  },
];

export const MonitoringEvents = memo(function MonitoringEvents({
  events,
  limited,
}: {
  events: Event[];
  limited: boolean;
}) {
  const pagination = useTablePagination({ pageSize: 10, total: events.length });
  const visibleEvents = events.slice(
    pagination.offset,
    pagination.offset + pagination.pageSize,
  );
  return (
    <section
      className="mt-4 grid min-w-0 gap-3"
      aria-label="Deployment and restart events"
    >
      <h3 className="font-medium">Deployment and restart events</h3>
      <div className="overflow-x-auto">
        <ResourceTable
          ariaLabel="Deployment and restart events"
          columns={columns}
          items={visibleEvents}
          getRowKey={(event) => `${event.type}:${event.id}:${event.at}`}
          emptyTitle="No events in this range"
          emptyDescription="Deployments and container restarts will appear here."
          tableClassName="min-w-[580px]"
        />
      </div>
      {events.length > pagination.pageSize ? (
        <Pagination
          aria-label="Deployment and restart event pages"
          page={pagination.page}
          size="sm"
          totalPages={pagination.totalPages ?? 1}
          onPageChange={pagination.setPage}
        />
      ) : null}
      {limited ? (
        <p className="text-xs text-muted">
          Showing the latest {events.length} events in this duration. Choose a
          shorter duration to see more detail.
        </p>
      ) : null}
    </section>
  );
});

export const monitoringEventColor = (type: Event["type"]) =>
  type === "deployment" ? "var(--accent)" : "var(--warning)";

export function MonitoringEventMarker({
  event,
  viewBox,
  onActiveChange,
}: {
  event: Event;
  onActiveChange?: (active: boolean) => void;
  viewBox?: { x?: number; y?: number };
}) {
  const [open, setOpen] = useState(false);
  const date = useMemo(
    () => eventTooltipDateFormatter.format(new Date(event.at)),
    [event.at],
  );
  useEffect(() => () => onActiveChange?.(false), [onActiveChange]);
  const changeOpen = (active: boolean) => {
    setOpen(active);
    onActiveChange?.(active);
  };
  if (viewBox?.x === undefined || viewBox.y === undefined) return null;
  const offset = event.type === "deployment" ? 9 : 25;
  const title =
    event.type === "deployment" ? "Deployment" : "Container restart";
  const label = `${title} ${event.id.slice(0, 8)} at ${date}`;
  return (
    <foreignObject
      x={viewBox.x - 10}
      y={viewBox.y + offset - 10}
      width={20}
      height={20}
      className="monitoring-event-marker"
      style={{ overflow: "visible" }}
    >
      <Tooltip isOpen={open} onOpenChange={changeOpen}>
        <Tooltip.Trigger
          aria-label={label}
          onMouseEnter={() => changeOpen(true)}
          onMouseLeave={() => changeOpen(false)}
          onFocus={() => changeOpen(true)}
          onBlur={() => changeOpen(false)}
          className="flex size-5 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <span
            className="flex size-3.5 items-center justify-center rounded-full text-[9px] font-semibold text-accent-foreground"
            style={{ background: monitoringEventColor(event.type) }}
          >
            {event.type === "deployment" ? "D" : "R"}
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content placement="top" className="max-w-xs text-xs" showArrow>
          <Tooltip.Arrow />
          <span className="grid gap-0.5">
            <span className="font-medium">
              {title} · {event.id.slice(0, 8)}
            </span>
            <span>
              {event.type === "deployment" ? event.state : "Restarted"} · {date}
            </span>
          </span>
        </Tooltip.Content>
      </Tooltip>
    </foreignObject>
  );
}
