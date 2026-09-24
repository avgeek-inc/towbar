"use client";

import { CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ManifestNotifications } from "@workspace/towbar-core";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";

import { NotificationProviderIcon } from "./notification-provider-icon";

type Subscription = {
  deployments: boolean;
  backupsAndRestores: boolean;
  alertsAndIncidents: boolean;
};
type Destination = Subscription & { label: string; key: string };

const subscriptionColumns = [
  { key: "deployments", label: "Deployments" },
  { key: "backupsAndRestores", label: "Backup & Restore" },
  { key: "alertsAndIncidents", label: "Alerts & Incidents" },
] as const;

const columns: ResourceTableColumn<Destination>[] = [
  {
    key: "destination",
    header: "Destination",
    className: "min-w-44",
    cell: (row) => row.label,
  },
  ...subscriptionColumns.map(({ key, label }) => ({
    key,
    header: label,
    headerClassName: "text-left",
    className: "min-w-32 text-left",
    cell: (row: Destination) =>
      row[key] ? (
        <span className="inline-flex items-center gap-1.5 text-success">
          <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-4" />
          <span className="sr-only">Enabled</span>
        </span>
      ) : (
        <span className="text-muted" aria-label="Not enabled">
          —
        </span>
      ),
  })),
];

export function DeployableNotifications({
  notifications,
}: {
  notifications?: ManifestNotifications;
}) {
  const providers = [
    {
      key: "email",
      label: "Email",
      icon: "smtp" as const,
      destinations: (notifications?.email ?? []).map((row) => ({
        ...row,
        key: row.address,
        label: row.address,
      })),
    },
    {
      key: "slack",
      label: "Slack",
      icon: "slack" as const,
      destinations: (notifications?.slack ?? []).map((row) => ({
        ...row,
        key: row.channelId,
        label: row.channelId,
      })),
    },
    {
      key: "discord",
      label: "Discord",
      icon: "discord" as const,
      destinations: (notifications?.discord ?? []).map((row) => ({
        ...row,
        key: row.webhookId,
        label: row.webhookId,
      })),
    },
    {
      key: "telegram",
      label: "Telegram",
      icon: "telegram" as const,
      destinations: (notifications?.telegram ?? []).map((row) => ({
        ...row,
        key: `${row.chatId}:${row.messageThreadId ?? 0}`,
        label: row.messageThreadId
          ? `${row.chatId} · Topic ${row.messageThreadId}`
          : row.chatId,
      })),
    },
  ].filter((provider) => provider.destinations.length > 0);

  if (!providers.length)
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No notification destinations</EmptyState.Title>
          <EmptyState.Description>
            Add destinations to this app or resource manifest, then sync the
            repository to receive its notifications here.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );

  return (
    <div className="content-grid">
      {providers.map((provider) => (
        <section className="min-w-0" key={provider.key}>
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium">
            <NotificationProviderIcon provider={provider.icon} />
            {provider.label}
          </h3>
          <ResourceTable
            ariaLabel={`${provider.label} notification destinations`}
            columns={columns}
            items={provider.destinations}
            getRowKey={(row) => row.key}
            emptyTitle="No destinations"
            emptyDescription="No destinations are configured for this provider."
            tableClassName="[&_.table__column]:py-2"
          />
        </section>
      ))}
    </div>
  );
}
