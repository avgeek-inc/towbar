"use client";

import {
  TableCellStack,
  TableCellDescription,
} from "@workspace/towbar-web-ui/table-cell-text";

import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  notificationCategoryPresentation,
  notificationHistoryCategories,
} from "./notification-categories";
import { NotificationProviderIcon } from "./notification-provider-icon";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import type { ResourceTableColumn } from "@workspace/towbar-web-ui/resource-table";
import { RelativeTime } from "./last-synced-time";
import { ScoutIcon } from "./scout-icons";
import {
  EventDetail,
  EventDetails,
  HistoryFilter,
  HistorySearch,
  HistoryTable,
  useEventHistory,
} from "./event-history";
const providerLabels = {
  slack: "Slack",
  smtp: "Email",
  discord: "Discord",
  telegram: "Telegram",
  webhook: "Webhook push",
};
const stateLabels = {
  pending: "Pending",
  delivering: "Sending",
  retrying: "Retrying",
  succeeded: "Sent",
  failed: "Failed",
};
type Delivery = {
  id: string;
  eventId: string;
  destinationId: string;
  provider: keyof typeof providerLabels;
  destination: string;
  destinationDeleted: string | null;
  type: string;
  category: string;
  title: string;
  entityId: string;
  entityName: string;
  sourceId: string | null;
  serverId: string | null;
  state: keyof typeof stateLabels;
  attemptCount: number;
  cycle: number;
  errorCode: string | null;
  nextAttemptAt: string | null;
  lastAttemptedAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
};
function deliveryStatusIcon(
  state: Delivery["state"],
  context: "chip" | "filter",
) {
  return (
    <span
      className={
        state === "succeeded"
          ? context === "chip"
            ? "text-success"
            : "text-success-soft-foreground"
          : undefined
      }
    >
      <ScoutIcon
        name={
          state === "succeeded"
            ? "resolved"
            : state === "failed"
              ? "critical"
              : "time"
        }
      />
    </span>
  );
}
function deliveryStatus(item: Delivery) {
  return (
    <Chip
      size="small"
      variant={
        item.state === "succeeded"
          ? "success"
          : item.state === "failed"
            ? "destructive"
            : "secondary"
      }
      icon={deliveryStatusIcon(item.state, "chip")}
      tooltip={
        item.state === "succeeded"
          ? "The provider accepted this notification."
          : (item.errorCode ?? undefined)
      }
    >
      {stateLabels[item.state]}
    </Chip>
  );
}
export function NotificationDeliveries({
  path = "/v1/core/notifications/deliveries",
}: {
  path?: string;
}) {
  const history = useEventHistory<Delivery>(path);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const [open, setOpen] = useState(false);
  const columns: ResourceTableColumn<Delivery>[] = [
    {
      key: "event",
      header: "Notification",
      cell: (item) => (
        <TableCellStack
          as="div"
          className="min-w-36 max-w-64 whitespace-normal"
        >
          <button
            type="button"
            className="cursor-pointer text-left underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-2 focus-visible:outline-focus"
            aria-label={`View delivery details for ${item.title}`}
            onClick={() => {
              setSelected(item);
              setOpen(true);
            }}
          >
            {item.title}
          </button>
          <TableCellDescription>{item.entityName}</TableCellDescription>
        </TableCellStack>
      ),
    },
    {
      key: "destination",
      header: "Destination",
      cell: (item) => (
        <TableCellStack
          as="div"
          className="min-w-28 max-w-48 whitespace-normal"
        >
          <span className="break-words [overflow-wrap:anywhere]">
            {item.destination}
          </span>
          <TableCellDescription className="flex items-center gap-1.5">
            <NotificationProviderIcon
              provider={item.provider}
              className="size-3 shrink-0"
            />
            {providerLabels[item.provider]}
            {item.destinationDeleted ? " · Removed" : ""}
          </TableCellDescription>
        </TableCellStack>
      ),
    },
    {
      key: "category",
      header: "Category",
      cell: (item) => <DeliveryCategory category={item.category} />,
    },
    { key: "status", header: "Status", cell: deliveryStatus },
    {
      key: "queued",
      header: "Queued",
      cell: (item) => <RelativeTime value={item.createdAt} label="Queued" />,
    },
  ];
  return (
    <div className="grid min-w-0 gap-6">
      <div className="grid items-end gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]">
        <div className="grid min-w-0 items-end gap-4 sm:grid-cols-3">
          <HistoryFilter
            label="Providers"
            value={history.filters.provider}
            allIcon={<ScoutIcon name="all" />}
            options={(
              Object.keys(providerLabels) as Delivery["provider"][]
            ).map((id) => ({
              id,
              label: providerLabels[id],
              icon: <NotificationProviderIcon provider={id} />,
            }))}
            onChange={(value) => history.setFilter("provider", value)}
          />
          <HistoryFilter
            label="Categories"
            value={history.filters.category}
            allIcon={<ScoutIcon name="all" />}
            options={notificationHistoryCategories.map((category) => ({
              id: category.key,
              label: category.label,
              icon: (
                <HugeiconsIcon
                  icon={category.icon}
                  className="size-4 shrink-0"
                />
              ),
            }))}
            onChange={(value) => history.setFilter("category", value)}
          />
          <HistoryFilter
            label="Statuses"
            value={history.filters.state}
            allIcon={<ScoutIcon name="all" />}
            options={(Object.keys(stateLabels) as Delivery["state"][]).map(
              (id) => ({
                id,
                label: stateLabels[id],
                icon: deliveryStatusIcon(id, "filter"),
              }),
            )}
            onChange={(value) => history.setFilter("state", value)}
          />
        </div>
        <HistorySearch
          label="Search deliveries"
          placeholder="Notification, entity or delivery ID"
          onSearch={(value) => history.setFilter("search", value)}
        />
      </div>
      <HistoryTable
        history={history}
        columns={columns}
        label="Deliveries"
        emptyDescription="Notification deliveries will appear here when an event is routed to a configured provider."
      />
      <EventDetails open={open} onOpenChange={setOpen} title="Delivery details">
        {selected ? (
          <>
            <EventDetail label="Notification" value={selected.title} />
            <EventDetail label="Status" value={deliveryStatus(selected)} />
            <EventDetail
              label="Provider"
              value={
                <span className="inline-flex items-center gap-1.5">
                  <NotificationProviderIcon provider={selected.provider} />
                  {providerLabels[selected.provider]}
                </span>
              }
            />
            <EventDetail label="Destination" value={selected.destination} />
            <EventDetail
              label="Category"
              value={<DeliveryCategory category={selected.category} />}
            />
            <EventDetail label="Event type" value={selected.type} />
            <EventDetail label="Entity" value={selected.entityName} />
            <EventDetail
              label="Queued"
              value={<RelativeTime value={selected.createdAt} label="Queued" />}
            />
            <EventDetail
              label="Sent"
              value={
                selected.deliveredAt ? (
                  <RelativeTime value={selected.deliveredAt} label="Sent" />
                ) : (
                  "Not sent"
                )
              }
            />
            <EventDetail label="Attempts" value={selected.attemptCount} />
            {selected.errorCode ? (
              <EventDetail label="Last error code" value={selected.errorCode} />
            ) : null}
            {selected.lastAttemptedAt ? (
              <EventDetail
                label="Last attempt"
                value={
                  <RelativeTime
                    value={selected.lastAttemptedAt}
                    label="Last attempt"
                  />
                }
              />
            ) : null}
            {selected.state === "retrying" && selected.nextAttemptAt ? (
              <EventDetail
                label="Next attempt"
                value={
                  <RelativeTime
                    value={selected.nextAttemptAt}
                    label="Next attempt"
                  />
                }
              />
            ) : null}
            <EventDetail label="Delivery ID" value={selected.id} copy />
            <EventDetail label="Event ID" value={selected.eventId} copy />
            <EventDetail
              label="Destination ID"
              value={selected.destinationId}
              copy
            />
            <EventDetail label="Entity ID" value={selected.entityId} copy />
          </>
        ) : null}
      </EventDetails>
    </div>
  );
}

function DeliveryCategory({ category }: { category: string }) {
  const presentation = notificationCategoryPresentation(category);
  return (
    <span className="inline-flex min-w-24 max-w-40 items-center gap-1.5 whitespace-normal">
      {presentation ? (
        <HugeiconsIcon
          icon={presentation.icon}
          className="size-4 shrink-0 text-muted"
          aria-hidden="true"
        />
      ) : null}
      {presentation?.label ?? category}
    </span>
  );
}
