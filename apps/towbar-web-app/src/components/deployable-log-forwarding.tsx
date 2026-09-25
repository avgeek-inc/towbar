"use client";

import { formatDistanceToNow } from "date-fns";
import type { LogDrainHealth, LogDrainProvider } from "@workspace/towbar-core";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { logDrainNames, logDrainStatus } from "@/lib/log-drain-providers";
import { IntegrationProviderLogo } from "./integration-provider-logo";

type Usage = {
  checkedAt: string | null;
  providers: { provider: LogDrainProvider; health: LogDrainHealth | null }[];
};

type Row = {
  provider: LogDrainProvider;
  configured: boolean;
  health: LogDrainHealth | null;
  attributes: Record<string, string>;
};

const columns: ResourceTableColumn<Row>[] = [
  {
    key: "provider",
    header: "Provider",
    className: "min-w-32",
    cell: (row) => (
      <span className="inline-flex items-center gap-2">
        <IntegrationProviderLogo provider={row.provider} />
        {logDrainNames[row.provider]}
      </span>
    ),
  },
  {
    key: "context",
    header: "Context",
    className: "min-w-0",
    cell: (row) =>
      Object.keys(row.attributes).length ? (
        <span className="block max-w-44 whitespace-normal break-words text-xs">
          {Object.entries(row.attributes)
            .map(([key, value]) => `${key}: ${value}`)
            .join(" · ")}
        </span>
      ) : (
        <span className="text-muted">Default fields</span>
      ),
  },
  {
    key: "status",
    header: "Delivery status",
    className: "min-w-32",
    cell: (row) =>
      row.configured ? (
        row.health ? (
          <StatusBadge {...logDrainStatus({ health: [row.health] })} />
        ) : (
          <span className="text-muted">Awaiting server check</span>
        )
      ) : (
        <StatusBadge {...logDrainStatus()} />
      ),
  },
  {
    key: "batches",
    header: "Delivery activity",
    className: "min-w-36 tabular-nums",
    cell: (row) =>
      row.health ? (
        <span className="grid w-32 whitespace-normal text-xs">
          <span>{row.health.acceptedBatches.toLocaleString()} accepted</span>
          <span className="text-muted">
            {row.health.droppedBatches.toLocaleString()} dropped
          </span>
          {row.health.lastSuccessAt ? (
            <time
              className="text-muted"
              dateTime={row.health.lastSuccessAt}
              title={new Date(row.health.lastSuccessAt).toLocaleString()}
            >
              Last accepted{" "}
              {formatDistanceToNow(new Date(row.health.lastSuccessAt), {
                addSuffix: true,
              })}
            </time>
          ) : null}
        </span>
      ) : (
        "—"
      ),
  },
];

export function DeployableLogForwarding({
  providers,
  serverId,
  attributes,
}: {
  providers?: LogDrainProvider[];
  serverId: string;
  attributes?: Partial<Record<LogDrainProvider, Record<string, string>>>;
}) {
  const query = useApiQuery<Usage>(
    providers?.length ? `/v1/core/log-drains/usage/${serverId}` : null,
    30_000,
  );
  if (!providers?.length)
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No log forwarding destinations</EmptyState.Title>
          <EmptyState.Description>
            Add logDrains to this app or resource manifest and sync the
            repository to forward its logs.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;

  const configured = new Map(
    query.data.providers.map((item) => [item.provider, item.health]),
  );
  const rows = providers.map((provider) => ({
    provider,
    configured: configured.has(provider),
    health: configured.get(provider) ?? null,
    attributes: attributes?.[provider] ?? {},
  }));
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        Destinations come from this workload’s manifest. Delivery counters are
        shared by all workloads using each provider on this server and reset
        when its runtime configuration changes. Manifest changes take effect
        after deployment and server reconciliation.
      </p>
      <ResourceTable
        ariaLabel="Log forwarding destinations"
        columns={columns}
        items={rows}
        getRowKey={(row) => row.provider}
        emptyTitle="No log forwarding destinations"
        emptyDescription="Select a provider in the workload manifest."
      />
      {query.data.checkedAt ? (
        <p className="text-xs text-muted">
          Last server check{" "}
          {formatDistanceToNow(new Date(query.data.checkedAt), {
            addSuffix: true,
          })}
          .
        </p>
      ) : null}
    </div>
  );
}
