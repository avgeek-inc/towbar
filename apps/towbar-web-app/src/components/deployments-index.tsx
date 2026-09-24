"use client";

import { DeploymentEnvironmentChip } from "./deployment-environment-chip";

import {
  FilterResetIcon,
  GitBranchIcon,
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
import { useTablePagination } from "@workspace/web-design-system/hooks/use-table-pagination";
import { Pagination } from "@workspace/web-design-system/navigation/pagination";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { DashboardPage, InlineLink } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";
import { deploymentHref } from "@/lib/deployment-route";
import {
  DeploymentTriggerChip,
  deploymentStatusTooltip,
} from "./deployment-table";
import { DeploymentDuration } from "./elapsed-time";
import { RelativeTime } from "./last-synced-time";
import { AppLogo, ResourceLogo } from "./deployable-identity";
import { resourceImageBrand } from "./resource-image-brand";
import { deploymentSubtitle } from "@/lib/overview";
import {
  TableCellDescription,
  TableCellStack,
} from "@workspace/towbar-web-ui/table-cell-text";

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
    cell: (item) => {
      const subtitle =
        deploymentSubtitle(item, item.deployableDomain ?? undefined) ?? "App";
      return (
        <InlineLink
          className="inline-flex min-w-0 items-center gap-2"
          href={`/${item.deployableKind === "app" ? "apps" : "resources"}/${item.appId}`}
        >
          {item.deployableKind === "app" ||
          item.deployableKind === "compose" ? (
            <AppLogo domain={item.deployableDomain ?? undefined} />
          ) : (
            <ResourceLogo
              brand={resourceImageBrand(
                item.deployableKind,
                item.deployableImage ?? "",
              )}
            />
          )}
          <TableCellStack className="min-w-0">
            <span className="truncate">{item.deployableName}</span>
            <TableCellDescription className="truncate">
              {subtitle}
            </TableCellDescription>
          </TableCellStack>
        </InlineLink>
      );
    },
    className: "min-w-56",
  },
  {
    key: "commit",
    header: "Commit",
    cell: (item) => (
      <TypographyCode title={item.commitSha}>
        {item.commitSha.slice(0, 8)}
      </TypographyCode>
    ),
    className: "min-w-32 whitespace-nowrap",
  },
  {
    key: "requested",
    header: "Requested",
    cell: (item) => <RelativeTime label="Requested" value={item.createdAt} />,
    className: "min-w-40 whitespace-nowrap",
  },
  {
    key: "environment",
    header: "Environment",
    cell: (item) => (
      <TableCellStack className="justify-items-start">
        <DeploymentEnvironmentChip deployment={item} />
        <TableCellDescription className="inline-flex items-center gap-1">
          <HugeiconsIcon
            aria-hidden="true"
            icon={GitBranchIcon}
            className="size-[1em] shrink-0"
          />
          <span className="font-mono">{item.targetEnvironment.branch}</span>
        </TableCellDescription>
      </TableCellStack>
    ),
    className: "min-w-36 whitespace-nowrap",
  },
  {
    key: "trigger",
    header: "Trigger",
    cell: (item) => <DeploymentTriggerChip trigger={item.trigger} />,
    className: "hidden whitespace-nowrap 2xl:table-cell",
    headerClassName: "hidden 2xl:table-cell",
  },
  {
    key: "duration",
    header: "Duration",
    cell: (item) => <DeploymentDuration deployment={item} />,
    className: "hidden 2xl:table-cell",
    headerClassName: "hidden 2xl:table-cell",
  },
  {
    key: "status",
    header: "Status",
    cell: (item) => (
      <StatusBadge
        status={getDeploymentDisplayStatus(item)}
        tooltip={deploymentStatusTooltip(item)}
      />
    ),
    className: "w-32 whitespace-nowrap",
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
    "targetEnvironment",
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
            value={search.get("targetEnvironment") ?? "all"}
            onChange={(v) => setFilter("targetEnvironment", v)}
            options={[
              { id: "all", label: "All environments" },
              ...(query.data?.environments ?? []).map((name) => ({
                id: name,
                label: name,
              })),
            ]}
          />
          <ScoutSelect
            label="Deployment kind"
            value={search.get("environment") ?? "all"}
            onChange={(v) => setFilter("environment", v)}
            options={[
              { id: "all", label: "All deployments" },
              { id: "production", label: "Persistent" },
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
              variant="secondary"
              onPress={() => {
                pagination.reset();
                window.history.pushState(null, "", pathname);
              }}
            >
              <HugeiconsIcon icon={FilterResetIcon} className="size-4" />
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
            getRowHref={deploymentHref}
            getRowKey={(item) => item.id}
            items={query.data.deployments}
            tableClassName="min-w-[1040px] 2xl:min-w-[1280px]"
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
