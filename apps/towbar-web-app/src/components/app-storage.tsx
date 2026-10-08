"use client";

import type { AppStorageResponse } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { ResourceTable } from "@avgeek-oss/design-system/patterns/resource-table";
import { Chip } from "@avgeek-oss/design-system/data-display/chip";
import { TypographyCode } from "@avgeek-oss/design-system/typography/typography";

import { useApiQuery } from "@/hooks/use-api-query";
import { formatDate } from "./dashboard-overview";
import { InlineLink } from "./page-parts";

const statuses = {
  mounted: { label: "Mounted", color: "success" },
  pending: { label: "Pending deployment", color: "warning" },
  retained: { label: "Retained", color: "default" },
  not_mounted: { label: "Not mounted", color: "warning" },
  unknown: { label: "Not checked", color: "default" },
} as const;

export function AppStorage({ appId }: { appId: string }) {
  const storage = useApiQuery<AppStorageResponse>(
    `/v1/core/apps/${appId}/storage`,
    10_000,
  );
  if (storage.error) return <QueryError message={storage.error} />;
  if (!storage.data) return <QueryLoading />;

  const { volumes, serverIp, serverId, checkedAt } = storage.data;
  return (
    <ResourceTable
      ariaLabel="Service persistent storage"
      items={volumes}
      getRowKey={(volume) => volume.name}
      emptyTitle="No persistent storage"
      emptyDescription="Declare container.volumes in the service manifest to keep uploads and other files across deployments."
      columns={[
        { key: "name", header: "Volume", cell: (volume) => volume.name },
        {
          key: "status",
          header: "Status",
          cell: (volume) => (
            <Chip color={statuses[volume.status].color} size="sm">
              <Chip.Label className="inline-flex items-center gap-1.5 whitespace-nowrap [&_svg]:size-3.5">
                {statuses[volume.status].label}
              </Chip.Label>
            </Chip>
          ),
        },
        {
          key: "path",
          header: "Container path",
          cell: (volume) => <TypographyCode>{volume.mountPath}</TypographyCode>,
        },
        {
          key: "server",
          header: "Server",
          cell: () => (
            <InlineLink href={`/servers/${serverId}/overview`}>
              {serverIp}
            </InlineLink>
          ),
        },
      ]}
      footer={
        checkedAt
          ? `Last checked ${formatDate(checkedAt)}`
          : "Mount status will appear after the next server check."
      }
    />
  );
}
