"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Resource, SourceBackup } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Card } from "@workspace/web-design-system/layout/card";
import { toast } from "@workspace/web-design-system/overlays/toast";
import {
  TypographyCode,
  TypographyHeading,
} from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";

import { ActionButton } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { RelativeTime, RelativeTimeProvider } from "./last-synced-time";
import { formatBytes } from "./runtime-operations";

export function ResourceBackups({
  active,
  resource,
}: {
  active: boolean;
  resource: Resource;
}) {
  const backups = useApiQuery<{ backups: SourceBackup[] }>(
    `/v1/core/sources/${resource.sourceId}/backups`,
    5_000,
  );
  if (backups.error) return <QueryError message={backups.error} />;
  if (!backups.data) return <QueryLoading variant="table" />;

  const ownBackups = backups.data.backups.filter(
    (backup) => backup.resourceId === resource.id,
  );
  const backupColumns: ResourceTableColumn<SourceBackup>[] = [
    {
      key: "created",
      header: "Created",
      cell: (backup) => (
        <RelativeTime label="Created" value={backup.createdAt} />
      ),
      className: "min-w-48 whitespace-nowrap",
    },
    {
      key: "size",
      header: "Size",
      cell: (backup) => formatBytes(backup.result.sizeBytes),
      className: "whitespace-nowrap tabular-nums",
    },
    {
      key: "object",
      header: "S3 object",
      cell: (backup) => <S3ObjectValue backup={backup} />,
      className: "w-full min-w-80",
    },
  ];

  return (
    <RelativeTimeProvider>
      <div className="grid gap-6">
        {resource.config.backup ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <Attributes title="Backup policy" variant="card">
              <Attributes.Item label="Schedule">
                {resource.config.backup.schedule ? (
                  <span className="inline-flex items-center gap-2">
                    <TypographyCode>
                      {resource.config.backup.schedule.cron}
                    </TypographyCode>
                    <span>UTC</span>
                  </span>
                ) : (
                  "Manual only"
                )}
              </Attributes.Item>
              <Attributes.Item label="Retention">
                Keep {resource.config.backup.retention.keepLast}
              </Attributes.Item>
              <Attributes.Item label="S3 location">
                <TypographyCode
                  className="block truncate"
                  title={`s3://${resource.config.backup.s3.bucket}/${resource.config.backup.s3.prefix}`}
                >
                  s3://{resource.config.backup.s3.bucket}/
                  {resource.config.backup.s3.prefix}
                </TypographyCode>
              </Attributes.Item>
              <Attributes.Item label="Encryption">
                {resource.config.backup.s3.encryption}
              </Attributes.Item>
            </Attributes>
            {active ? (
              <Card className="min-h-52">
                <Card.Header>
                  <Card.Title>Manual backup</Card.Title>
                </Card.Header>
                <Card.Content className="text-muted typography--body-sm">
                  Capture the current database state now.
                </Card.Content>
                <Card.Footer>
                  <ActionButton
                    action={() =>
                      api.post(
                        `/v1/core/resources/${resource.id}/actions/backup`,
                        undefined,
                        { "Idempotency-Key": crypto.randomUUID() },
                      )
                    }
                    pendingLabel="Queueing backup…"
                    success="Backup queued"
                    variant="primary"
                  >
                    Back up now
                  </ActionButton>
                </Card.Footer>
              </Card>
            ) : null}
          </div>
        ) : (
          <EmptyState>
            <EmptyState.Header>
              <EmptyState.Title>Backups not configured</EmptyState.Title>
              <EmptyState.Description>
                Declare backup.s3 in .towbar/deployment.yml to enable backups
                for this Resource.
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        )}

        <section
          aria-labelledby="resource-backups-title"
          className="grid gap-4"
        >
          <TypographyHeading
            elementType="h2"
            id="resource-backups-title"
            level={5}
          >
            Retained backups
          </TypographyHeading>
          <ResourceTable
            ariaLabel={`${resource.name} backups`}
            columns={backupColumns}
            emptyDescription="Create a manual backup or wait for the next scheduled backup."
            emptyTitle="No retained backups"
            getRowKey={(backup) => backup.id}
            items={ownBackups}
          />
        </section>
      </div>
    </RelativeTimeProvider>
  );
}

function S3ObjectValue({ backup }: { backup: SourceBackup }) {
  const object = `${backup.result.bucket}/${backup.result.key}`;

  async function copyObject() {
    try {
      await navigator.clipboard.writeText(object);
      toast.success("S3 object copied");
    } catch {
      toast.danger("Couldn't copy the S3 object");
    }
  }

  return (
    <span className="flex min-w-0 items-center gap-2">
      <TypographyCode className="block min-w-0 flex-1 truncate" title={object}>
        {object}
      </TypographyCode>
      <Button
        aria-label={`Copy S3 object ${object}`}
        className="min-h-11 min-w-11 shrink-0"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={copyObject}
      >
        <HugeiconsIcon aria-hidden="true" icon={Copy01Icon} />
      </Button>
    </span>
  );
}
