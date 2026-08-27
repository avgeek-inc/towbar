"use client";

import { Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Resource, SourceBackup } from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Card } from "@workspace/web-design-system/layout/card";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { ActionButton } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

export function ResourceBackupConfiguration({
  active,
  resource,
}: {
  active: boolean;
  resource: Resource;
}) {
  const backup = resource.config.backup;

  if (!backup) {
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>Backups not configured</EmptyState.Title>
          <EmptyState.Description>
            Declare backup.s3 in .towbar/deployment.yml to enable backups for
            this Resource.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <Attributes title="Backup policy" variant="card">
        <Attributes.Item label="Schedule">
          {backup.schedule ? (
            <span className="inline-flex items-center gap-2">
              <TypographyCode>{backup.schedule.cron}</TypographyCode>
              <span>UTC</span>
            </span>
          ) : (
            "Manual only"
          )}
        </Attributes.Item>
        <Attributes.Item label="Retention">
          Keep {backup.retention.keepLast}
        </Attributes.Item>
        <Attributes.Item label="S3 location">
          <TypographyCode
            className="block truncate"
            title={`s3://${backup.s3.bucket}/${backup.s3.prefix}`}
          >
            s3://{backup.s3.bucket}/{backup.s3.prefix}
          </TypographyCode>
        </Attributes.Item>
        <Attributes.Item label="Encryption">
          {backup.s3.encryption}
        </Attributes.Item>
        <Attributes.Item label="Last backed up">
          <LatestBackupValue resource={resource} />
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
  );
}

function LatestBackupValue({ resource }: { resource: Resource }) {
  const backups = useApiQuery<{ backups: SourceBackup[] }>(
    `/v1/core/sources/${resource.sourceId}/backups`,
    5_000,
  );
  const latestBackup = backups.data?.backups.find(
    (backup) => backup.resourceId === resource.id,
  );

  if (backups.error) return "Unavailable";
  if (!backups.data) return "Checking…";
  if (!latestBackup) return "Not backed up yet";

  const backedUpAt = latestBackup.finishedAt ?? latestBackup.createdAt;
  const label = formatDate(backedUpAt);
  const objectKey = latestBackup.result.key;

  async function copyObjectKey() {
    try {
      await navigator.clipboard.writeText(objectKey);
      toast.success("S3 object key copied");
    } catch {
      toast.danger("Couldn't copy the S3 object key");
    }
  }

  return (
    <Button
      aria-label={`Copy S3 object key from backup created ${label}`}
      className="-ml-2 h-auto min-h-11 justify-start gap-2 px-2 py-0 font-normal"
      size="sm"
      variant="ghost"
      onPress={copyObjectKey}
    >
      <span>{label}</span>
      <HugeiconsIcon aria-hidden="true" className="size-4" icon={Copy01Icon} />
    </Button>
  );
}
