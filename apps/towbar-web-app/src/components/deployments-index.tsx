"use client";

import {
  Cancel01Icon,
  DashboardCircleIcon,
  DatabaseIcon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import {
  deploymentStates,
  type DeploymentHistoryItem,
  type DeploymentHistoryPage,
  type Server,
} from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { DashboardPage, InlineLink } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";
import { DeploymentTriggerChip } from "./deployment-table";
import { DeploymentDuration } from "./elapsed-time";
import { RelativeTime } from "./last-synced-time";

import { usePathname, useSearchParams } from "next/navigation";
import { SecondarySection } from "./secondary-sidebar";
import { ScoutSelect } from "./scout-controls";
import { Button } from "@workspace/web-design-system/buttons/button";

const columns: ResourceTableColumn<DeploymentHistoryItem>[] = [
  {
    key: "id",
    header: "Deployment ID",
    cell: (item) => (
      <TypographyCode title={item.id}>{item.id.slice(0, 8)}</TypographyCode>
    ),
    className: "min-w-40",
  },
  {
    key: "deployable",
    header: "App / Resource",
    cell: (item) => (
      <span className="inline-flex items-center gap-2">
        <InlineLink
          className="inline-flex items-center gap-2"
          href={`/sources/${item.sourceId}/${item.deployableKind === "app" ? "apps" : "resources"}/${item.appId}`}
        >
          <HugeiconsIcon
            aria-hidden="true"
            className="size-4 shrink-0"
            icon={
              item.deployableKind === "app" ? DashboardCircleIcon : DatabaseIcon
            }
          />
          {item.deployableName}
        </InlineLink>
        {item.environment === "preview" ? (
          <Chip
            size="small"
            variant="secondary"
            icon={<HugeiconsIcon icon={Rocket01Icon} />}
          >
            Preview
          </Chip>
        ) : null}
      </span>
    ),
    className: "min-w-56",
  },
  {
    key: "trigger",
    header: "Trigger",
    cell: (item) => <DeploymentTriggerChip trigger={item.trigger} />,
    className: "whitespace-nowrap",
  },
  {
    key: "requested",
    header: "Requested",
    cell: (item) => <RelativeTime label="Requested" value={item.createdAt} />,
    className: "min-w-40 whitespace-nowrap",
  },
  {
    key: "duration",
    header: "Duration",
    cell: (item) => <DeploymentDuration deployment={item} />,
  },
  {
    key: "status",
    header: "Status",
    cell: (item) => <StatusBadge status={getDeploymentDisplayStatus(item)} />,
    className: "whitespace-nowrap",
  },
];

export function DeploymentsIndex() {
  const pagination = useTablePagination({ pageSize: 10 });
  const search = useSearchParams();
  const pathname = usePathname();
  const servers = useApiQuery<{ servers: Server[] }>("/v1/core/servers");
  const filters = [
    "type",
    "environment",
    "state",
    "trigger",
    "serverId",
    "sort",
  ];
  const params = new URLSearchParams();
  for (const name of filters) {
    const value = search.get(name);
    if (value) params.set(name, value);
  }
  function setFilter(name: string, value: string) {
    const next = new URLSearchParams(search.toString());
    if (value === "all" || value === "newest") next.delete(name);
    else next.set(name, value);
    pagination.reset();
    window.history.pushState(
      null,
      "",
      `${pathname}${next.size ? `?${next}` : ""}`,
    );
  }

  const query = useApiQuery<DeploymentHistoryPage>(
    `/v1/core/deployments/history?page=${pagination.page}&limit=${pagination.pageSize}&${params}`,
    5_000,
  );
  const { setTotal, reset } = pagination;
  const filterKey = params.toString();
  useEffect(() => reset(), [filterKey, reset]);
  useEffect(() => {
    if (!query.data) return;
    setTotal(query.data.pagination.total);
    if (!query.data.pagination.total) reset();
  }, [query.data, reset, setTotal]);

  return (
    <DashboardPage icon={Rocket01Icon} title="Deployments">
      <SecondarySection title="Filter deployments">
        <div className="grid gap-4">
          <ScoutSelect
            label="Type"
            value={search.get("type") ?? "all"}
            onChange={(v) => setFilter("type", v)}
            options={[
              { id: "all", label: "All workloads" },
              { id: "app", label: "Apps" },
              { id: "resource", label: "Resources" },
            ]}
          />
          <ScoutSelect
            label="Environment"
            value={search.get("environment") ?? "all"}
            onChange={(v) => setFilter("environment", v)}
            options={[
              { id: "all", label: "All environments" },
              { id: "production", label: "Production" },
              { id: "preview", label: "Preview" },
            ]}
          />
          <ScoutSelect
            label="Status"
            value={search.get("state") ?? "all"}
            onChange={(v) => setFilter("state", v)}
            options={[
              { id: "all", label: "All statuses" },
              ...deploymentStates.map((id) => ({
                id,
                label: id
                  .replaceAll("_", " ")
                  .replace(/^./, (c) => c.toUpperCase()),
              })),
            ]}
          />
          <ScoutSelect
            label="Trigger"
            value={search.get("trigger") ?? "all"}
            onChange={(v) => setFilter("trigger", v)}
            options={[
              { id: "all", label: "All triggers" },
              { id: "manual", label: "Manual" },
              { id: "auto_deploy", label: "Auto-deploy" },
              { id: "rollback", label: "Rollback" },
            ]}
          />
          <ScoutSelect
            label="Server"
            value={search.get("serverId") ?? "all"}
            onChange={(v) => setFilter("serverId", v)}
            options={[
              { id: "all", label: "All servers" },
              ...(servers.data?.servers ?? []).map((server) => ({
                id: server.id,
                label: server.canonicalIp,
              })),
            ]}
          />
          {params.size > 0 ? (
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                pagination.reset();
                window.history.pushState(null, "", pathname);
              }}
            >
              <HugeiconsIcon icon={Cancel01Icon} className="size-4" />
              Clear filters
            </Button>
          ) : null}
        </div>
      </SecondarySection>
      <SecondarySection title="Sort deployments">
        <ScoutSelect
          label="Sort"
          hideLabel
          value={search.get("sort") ?? "newest"}
          onChange={(v) => setFilter("sort", v)}
          options={[
            { id: "newest", label: "Newest first" },
            { id: "oldest", label: "Oldest first" },
            { id: "name_asc", label: "Workload A–Z" },
            { id: "name_desc", label: "Workload Z–A" },
          ]}
        />
      </SecondarySection>
      <div className="grid gap-4">
        {query.error ? (
          <QueryError message={query.error} />
        ) : !query.data ? (
          <QueryLoading variant="table" />
        ) : (
          <ResourceTable
            ariaLabel="All deployments"
            columns={columns}
            emptyTitle={
              params.size ? "No matching deployments" : "No deployments yet"
            }
            emptyDescription={
              params.size
                ? "Try changing or clearing the filters."
                : "Deploy an app or resource to see its deployment history here."
            }
            getRowHref={(item) =>
              `/sources/${item.sourceId}/deployments/${item.id}`
            }
            getRowKey={(item) => item.id}
            items={query.data.deployments}
            tableClassName="min-w-[1040px]"
          />
        )}
        {(pagination.totalPages ?? 0) > 1 ? (
          <Pagination
            aria-label="Deployment pages"
            page={pagination.page}
            size="sm"
            totalPages={pagination.totalPages ?? 1}
            onPageChange={pagination.setPage}
          />
        ) : null}
      </div>
    </DashboardPage>
  );
}
