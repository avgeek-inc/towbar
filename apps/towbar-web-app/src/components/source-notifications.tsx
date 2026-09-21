"use client";

import type { NotificationDestination } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceName,
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { NotificationProviderIcon } from "./notification-provider-icon";

type Provider = NotificationDestination["provider"];
export type ProviderAvailability = Record<Provider, boolean>;
export type NotificationDestinationsResponse = {
  canManageNotifications: boolean;
  destinations: NotificationDestination[];
  providers: ProviderAvailability;
};

type Query<T> = {
  data?: T;
  error?: string;
  refresh: () => void;
};

type SourceNotificationsProps = {
  canManage: boolean;
  destinations: Query<NotificationDestinationsResponse>;
} & (
  | { provider: Provider; sourceId?: never; workspace: true }
  | { provider?: never; sourceId: string; workspace?: false }
);

export function SourceNotifications({
  destinations,
  provider,
}: SourceNotificationsProps) {
  if (destinations.error) return <QueryError message={destinations.error} />;
  if (!destinations.data) return <QueryLoading />;

  const visible = provider
    ? destinations.data.destinations.filter(
        (destination) => destination.provider === provider,
      )
    : destinations.data.destinations;
  const columns: ResourceTableColumn<NotificationDestination>[] = [
    {
      key: "route",
      header: "Route",
      cell: (destination) => (
        <span className="flex items-center gap-2">
          <NotificationProviderIcon provider={destination.provider} />
          <ResourceName
            name={destination.id}
            description={destination.provider}
          />
        </span>
      ),
      className: "min-w-56",
    },
    {
      key: "categories",
      header: "Categories",
      cell: (destination) => destination.categories.join(", "),
      className: "min-w-64",
    },
    {
      key: "status",
      header: "Status",
      cell: () => <StatusBadge status="configured" label="Configured" />,
    },
  ];

  return (
    <div className="content-grid">
      <p className="text-sm text-muted">
        Notification routes are managed by the Towbar runtime environment.
        Values and secrets are not shown in the application.
      </p>
      <ResourceTable<NotificationDestination>
        ariaLabel="Notification routes"
        columns={columns}
        items={visible}
        getRowKey={(destination) => destination.id}
        emptyTitle="No notification routes"
        emptyDescription="No environment route is enabled for this scope."
      />
    </div>
  );
}
