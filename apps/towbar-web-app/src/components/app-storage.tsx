"use client";

import type { AppStorageResponse } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { ResourceTable } from "@workspace/towbar-web-ui/resource-table";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { useApiQuery } from "@/hooks/use-api-query";
import { formatDate } from "./dashboard-overview";
import { InlineLink } from "./page-parts";

const statuses = {
  mounted: { label: "Mounted", color: "success" },
  pending: { label: "Pending deployment", color: "warning" },
  retained: { label: "Retained", color: "secondary" },
  not_mounted: { label: "Not mounted", color: "warning" },
  unknown: { label: "Not checked", color: "secondary" },
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
      emptyDescription="Declare container.volumes in the app manifest to keep uploads and other files across deployments."
      columns={[
        { key: "name", header: "Volume", cell: (volume) => volume.name },
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
        {
          key: "status",
          header: "Status",
          cell: (volume) => (
            <Chip variant={statuses[volume.status].color} size="small">
              {statuses[volume.status].label}
            </Chip>
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
