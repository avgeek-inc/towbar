"use client";
import { useState } from "react";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Button } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { useApiQuery } from "@/hooks/use-api-query";
import { RelativeTime } from "./last-synced-time";
import { ScoutIcon } from "./scout-icons";
type Delivery = {
  id: string;
  type: string;
  provider: "slack" | "smtp";
  destination: string;
  state: string;
  createdAt: string;
  deliveredAt: string | null;
  attemptCount: number;
  errorCode: string | null;
};
export function ScoutIncidentNotifications({
  serverId,
  incidentId,
}: {
  serverId: string;
  incidentId: string;
}) {
  const [cursors, setCursors] = useState<string[]>([""]);
  const query = useApiQuery<{
    items: Delivery[];
    nextBefore: string | null;
    nextBeforeId: string | null;
  }>(
    `/v1/core/servers/${serverId}/scout-alerts/incidents/${incidentId}/notifications?limit=10${cursors.at(-1)}`,
    30_000,
    { keepPreviousData: true },
  );
  const columns: ResourceTableColumn<Delivery>[] = [
    {
      key: "destination",
      header: "Destination",
      cell: (d) => (
        <div className="grid min-w-40 gap-1">
          <span>{d.destination}</span>
          <span className="flex items-center gap-1 text-xs text-muted">
            <ScoutIcon name={d.provider} />
            {d.provider === "smtp" ? "Email" : "Slack"} ·{" "}
            {d.type === "scout.recovered" ? "Recovery" : "Alert"}
          </span>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (d) => (
        <div className="grid min-w-20 gap-1">
          <Chip
            size="small"
            icon={
              <ScoutIcon
                name={
                  d.state === "succeeded"
                    ? "resolved"
                    : d.state === "failed"
                      ? "critical"
                      : "time"
                }
              />
            }
            variant={
              d.state === "succeeded"
                ? "success"
                : d.state === "failed"
                  ? "destructive"
                  : "secondary"
            }
          >
            {d.state === "succeeded"
              ? "Sent"
              : d.state[0]!.toUpperCase() + d.state.slice(1)}
          </Chip>
          <span className="whitespace-nowrap text-xs text-muted">
            {d.attemptCount} {d.attemptCount === 1 ? "attempt" : "attempts"}
            {d.errorCode ? ` · ${d.errorCode}` : ""}
          </span>
        </div>
      ),
    },
    {
      key: "time",
      header: "Sent",
      cell: (d) =>
        d.deliveredAt ? (
          <RelativeTime label="Sent" value={d.deliveredAt} />
        ) : (
          <span className="text-sm text-muted">Not sent</span>
        ),
    },
    {
      key: "queued",
      header: "Queued",
      cell: (d) => <RelativeTime label="Queued" value={d.createdAt} />,
    },
  ];
  return (
    <div className="grid min-w-0 gap-4">
      {query.error ? <QueryError message={query.error} /> : null}
      {query.data ? (
        <ResourceTable
          ariaLabel="Incident notifications"
          columns={columns}
          items={query.data.items}
          getRowKey={(d) => d.id}
          emptyTitle="No notifications sent"
          emptyDescription="Notification deliveries for this incident will appear here."
        />
      ) : !query.error ? (
        <QueryLoading />
      ) : null}
      {cursors.length > 1 || query.data?.nextBefore ? (
        <div className="flex items-center justify-end gap-2">
          <span className="text-sm text-muted">Page {cursors.length}</span>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={cursors.length === 1 || query.isPreviousData}
            onPress={() => setCursors((old) => old.slice(0, -1))}
          >
            <ScoutIcon name="previous" />
            Previous
          </Button>
          <Button
            variant="secondary"
            size="sm"
            isDisabled={!query.data?.nextBefore || query.isPreviousData}
            onPress={() =>
              setCursors((old) => [
                ...old,
                `&before=${encodeURIComponent(query.data!.nextBefore!)}&beforeId=${query.data!.nextBeforeId}`,
              ])
            }
          >
            Next
            <ScoutIcon name="next" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
