"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import type {
  BackupAssurance,
  Resource,
  ResourceOperation,
  ResourceOperationEvent,
  RestoreResult,
  SourceBackup,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@workspace/web-design-system/forms/field";
import { Input } from "@workspace/web-design-system/forms/input";
import { Card } from "@workspace/web-design-system/layout/card";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { toast } from "@workspace/web-design-system/overlays/toast";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  ResourceName,
  ResourceTable,
  type ResourceTableColumn,
} from "@workspace/towbar-web-ui/resource-table";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton } from "@/components/page-parts";
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { formatBytes } from "./runtime-operations";

type AssuranceResponse = {
  assurance: BackupAssurance | null;
  assurances: BackupAssurance[];
  canRestore: boolean;
};

export function ResourceBackupConfiguration({
  active,
  resource,
}: {
  active: boolean;
  resource: Resource;
}) {
  const backup = resource.config.backup;
  const backups = useApiQuery<{ backups: SourceBackup[] }>(
    `/v1/core/sources/${resource.sourceId}/backups`,
    5_000,
  );
  const assurances = useApiQuery<AssuranceResponse>(
    `/v1/core/resources/${resource.id}/backup-assurance`,
    5_000,
  );
  const operations = useApiQuery<{ operations: ResourceOperation[] }>(
    `/v1/core/resources/${resource.id}/operations`,
    3_000,
  );
  const [selectedBackup, setSelectedBackup] = useState<SourceBackup | null>(
    null,
  );

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

  const error = backups.error ?? assurances.error ?? operations.error;
  if (error) return <QueryError message={error} />;
  if (!backups.data || !assurances.data || !operations.data) {
    return <QueryLoading />;
  }

  const retainedBackups = backups.data.backups.filter(
    (candidate) => candidate.resourceId === resource.id,
  );
  const restoreOperations = operations.data.operations.filter(
    (operation) =>
      operation.type === "restore" || operation.type === "restore_cleanup",
  );
  const assuranceData = assurances.data;
  const assuranceByBackup = new Map(
    assuranceData.assurances.map((item) => [item.backupOperationId, item]),
  );
  const latestBackup = retainedBackups[0];
  const latestAssurance = latestBackup
    ? assuranceByBackup.get(latestBackup.id)
    : undefined;

  const backupColumns: ResourceTableColumn<SourceBackup>[] = [
    {
      key: "created",
      header: "Created",
      cell: (item) => (
        <ResourceName
          description={formatBytes(item.result.sizeBytes)}
          name={formatDate(item.finishedAt ?? item.createdAt)}
        />
      ),
      className: "min-w-52",
    },
    {
      key: "engine",
      header: "Engine",
      cell: (item) =>
        item.result.engine && item.result.engineMajorVersion
          ? `${formatEngine(item.result.engine)} ${item.result.engineMajorVersion}`
          : "Metadata missing",
    },
    {
      key: "format",
      header: "Format",
      cell: (item) => formatBackupFormat(item.result.format),
    },
    {
      key: "assurance",
      header: "Restore assurance",
      cell: (item) => (
        <StatusBadge
          status={assuranceByBackup.get(item.id)?.status ?? "unknown"}
        />
      ),
    },
    {
      key: "actions",
      header: "Action",
      cell: (item) => {
        const assurance = assuranceByBackup.get(item.id);
        return (
          <Button
            isDisabled={
              !active ||
              !assuranceData.canRestore ||
              !assurance?.restoreReady ||
              restoreOperations.some((operation) =>
                ["queued", "running"].includes(operation.state),
              )
            }
            size="sm"
            variant="secondary"
            onPress={() => setSelectedBackup(item)}
          >
            Restore
          </Button>
        );
      },
      className: "whitespace-nowrap",
    },
  ];

  return (
    <div className="grid gap-8">
      <div
        className={
          active
            ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.65fr)]"
            : "grid gap-4"
        }
      >
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
            {latestBackup ? (
              <CopyBackupKey backup={latestBackup} />
            ) : (
              "Not backed up yet"
            )}
          </Attributes.Item>
        </Attributes>
        {active ? (
          <Card>
            <Card.Header>
              <Card.Title>Restore assurance</Card.Title>
              <StatusBadge status={latestAssurance?.status ?? "missing"} />
            </Card.Header>
            <Card.Content className="grid gap-3">
              <p className="text-muted typography--body-sm">
                {latestAssurance
                  ? `Checked ${formatDate(latestAssurance.checkedAt)}`
                  : "Run a backup before Towbar can verify restore readiness."}
              </p>
              {latestAssurance ? (
                <ul className="grid gap-2">
                  {latestAssurance.checks.map((check) => (
                    <li
                      className="flex items-start gap-2 typography--body-sm"
                      key={check.name}
                    >
                      <span
                        aria-hidden="true"
                        className={
                          check.passed ? "text-success" : "text-danger"
                        }
                      >
                        {check.passed ? "●" : "○"}
                      </span>
                      <span>{check.message}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
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

      <section className="grid gap-3">
        <h4 className="typography--heading-sm">Retained backups</h4>
        <ResourceTable
          ariaLabel="Retained backups"
          columns={backupColumns}
          emptyDescription="Run a backup to create the first retained restore point."
          emptyTitle="No retained backups"
          getRowKey={(item) => item.id}
          items={retainedBackups}
        />
      </section>

      {restoreOperations.length ? (
        <RestoreHistory
          canManage={active && assuranceData.canRestore}
          operations={restoreOperations}
          resourceId={resource.id}
        />
      ) : null}

      <RestoreConfirmation
        backup={selectedBackup}
        resource={resource}
        onClose={() => setSelectedBackup(null)}
      />
    </div>
  );
}

function RestoreConfirmation({
  backup,
  onClose,
  resource,
}: {
  backup: SourceBackup | null;
  onClose: () => void;
  resource: Resource;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  function close() {
    setConfirmation("");
    setReason("");
    setError(undefined);
    onClose();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!backup) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api.post(
        `/v1/core/resources/${resource.id}/actions/restore`,
        { backupId: backup.id, confirmation, reason },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      toast.success("Database restore queued");
      refreshApiQueries();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Restore failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(backup)}
      onOpenChange={(open) => {
        if (!open && !submitting) close();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container scroll="inside" size="lg">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Restore {resource.name}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form className="grid gap-5" onSubmit={submit}>
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>This replaces the active database</Alert.Title>
                    <Alert.Description>
                      Towbar restores into an isolated candidate first. After
                      validation, promotion briefly replaces the active volume.
                      Promotion cannot be cancelled; the previous volume is
                      retained for rollback for seven days.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
                {backup ? (
                  <Attributes columns={2} title="Selected backup">
                    <Attributes.Item label="Created">
                      {formatDate(backup.finishedAt ?? backup.createdAt)}
                    </Attributes.Item>
                    <Attributes.Item label="Size">
                      {formatBytes(backup.result.sizeBytes)}
                    </Attributes.Item>
                    <Attributes.Item label="Engine">
                      {formatEngine(backup.result.engine)}{" "}
                      {backup.result.engineMajorVersion}
                    </Attributes.Item>
                    <Attributes.Item label="Checksum">
                      <TypographyCode title={backup.result.checksum}>
                        {backup.result.checksum.slice(0, 12)}
                      </TypographyCode>
                    </Attributes.Item>
                  </Attributes>
                ) : null}
                {error ? (
                  <Alert status="danger">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Title>Couldn&apos;t queue restore</Alert.Title>
                      <Alert.Description>{error}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : null}
                <Field>
                  <FieldLabel htmlFor="restore-reason">Reason</FieldLabel>
                  <Input
                    id="restore-reason"
                    minLength={10}
                    required
                    value={reason}
                    variant="secondary"
                    onChange={(event) => setReason(event.currentTarget.value)}
                  />
                  <FieldDescription>
                    Recorded in the restore audit trail. Minimum 10 characters.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="restore-confirmation">
                    Type {resource.name} to confirm
                  </FieldLabel>
                  <Input
                    id="restore-confirmation"
                    required
                    value={confirmation}
                    variant="secondary"
                    onChange={(event) =>
                      setConfirmation(event.currentTarget.value)
                    }
                  />
                </Field>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    isDisabled={submitting}
                    variant="secondary"
                    onPress={close}
                  >
                    Cancel
                  </Button>
                  <Button
                    isDisabled={
                      submitting ||
                      confirmation !== resource.name ||
                      reason.trim().length < 10
                    }
                    type="submit"
                    variant="danger"
                  >
                    {submitting ? "Queueing restore…" : "Restore database"}
                  </Button>
                </div>
              </form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function RestoreHistory({
  canManage,
  operations,
  resourceId,
}: {
  canManage: boolean;
  operations: ResourceOperation[];
  resourceId: string;
}) {
  const [cleanupOperation, setCleanupOperation] =
    useState<ResourceOperation | null>(null);
  const latestRestore = operations.find(
    (operation) => operation.type === "restore",
  );
  const cleanupByRestore = new Set(
    operations
      .filter(
        (operation) =>
          operation.type === "restore_cleanup" &&
          ["queued", "running", "succeeded"].includes(operation.state),
      )
      .map((operation) =>
        operation.request.type === "restore_cleanup"
          ? operation.request.restoreId
          : null,
      )
      .filter((restoreId): restoreId is string => Boolean(restoreId)),
  );
  const restoreColumns: ResourceTableColumn<ResourceOperation>[] = [
    {
      key: "operation",
      header: "Restore",
      cell: (operation) => (
        <ResourceName
          description={formatDate(operation.createdAt)}
          name={operation.id.slice(0, 8)}
        />
      ),
    },
    {
      key: "reason",
      header: "Reason",
      cell: (operation) => readString(operation.request.reason) ?? "—",
      className: "min-w-64",
    },
    {
      key: "phase",
      header: "Phase",
      cell: (operation) => formatPhase(operation.phase),
    },
    {
      key: "status",
      header: "Status",
      cell: (operation) => <StatusBadge status={operation.state} />,
    },
    {
      key: "rollback",
      header: "Rollback retention",
      cell: (operation) => {
        const result = readRestoreResult(operation.result);
        return result?.rollbackAvailableUntil
          ? formatDate(result.rollbackAvailableUntil)
          : "—";
      },
    },
    {
      key: "action",
      header: "Action",
      cell: (operation) => (
        <RestoreOperationAction
          canManage={canManage}
          cleanupCompleted={cleanupByRestore.has(operation.id)}
          operation={operation}
          resourceId={resourceId}
          onCleanup={() => setCleanupOperation(operation)}
        />
      ),
    },
  ];
  return (
    <section className="grid gap-3">
      <h4 className="typography--heading-sm">Restore history</h4>
      {latestRestore && ["queued", "running"].includes(latestRestore.state) ? (
        <RestoreProgress operation={latestRestore} resourceId={resourceId} />
      ) : null}
      <ResourceTable
        ariaLabel="Restore history"
        columns={restoreColumns}
        emptyDescription="Restore operations appear here with their audit trail."
        emptyTitle="No restore history"
        getRowKey={(operation) => operation.id}
        items={operations}
      />
      <RestoreCleanupConfirmation
        operation={cleanupOperation}
        resourceId={resourceId}
        onClose={() => setCleanupOperation(null)}
      />
    </section>
  );
}

function RestoreProgress({
  operation,
  resourceId,
}: {
  operation: ResourceOperation;
  resourceId: string;
}) {
  const events = useApiQuery<{ events: ResourceOperationEvent[] }>(
    `/v1/core/resources/${resourceId}/operations/${operation.id}/events`,
    2_000,
  );
  return (
    <Card>
      <Card.Header>
        <Card.Title>Restore progress</Card.Title>
        <StatusBadge status={operation.state} />
      </Card.Header>
      <Card.Content>
        {events.error ? <QueryError message={events.error} /> : null}
        {!events.data && !events.error ? <QueryLoading variant="list" /> : null}
        {events.data ? (
          <ol className="grid gap-3">
            {events.data.events.map((event) => (
              <li className="grid gap-1" key={event.id}>
                <span className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={event.level} />
                  <span className="font-medium">
                    {formatPhase(event.phase)}
                  </span>
                  <span className="text-muted typography--body-xs">
                    {formatDate(event.createdAt)}
                  </span>
                </span>
                <span className="text-muted typography--body-sm">
                  {event.message}
                </span>
                {event.command ? (
                  <TypographyCode>{event.command}</TypographyCode>
                ) : null}
              </li>
            ))}
          </ol>
        ) : null}
      </Card.Content>
    </Card>
  );
}

function RestoreOperationAction({
  canManage,
  cleanupCompleted,
  onCleanup,
  operation,
  resourceId,
}: {
  canManage: boolean;
  cleanupCompleted: boolean;
  onCleanup: () => void;
  operation: ResourceOperation;
  resourceId: string;
}) {
  const result = readRestoreResult(operation.result);
  const cancellable =
    operation.type === "restore" &&
    ["queued", "running"].includes(operation.state) &&
    ![
      "promoting",
      "verifying_promotion",
      "rolling_back",
      "retaining_previous",
    ].includes(operation.phase ?? "");
  const cleanable =
    operation.type === "restore" &&
    operation.state === "succeeded" &&
    !cleanupCompleted &&
    Boolean(result?.previousVolumes.length);
  if (!canManage || (!cancellable && !cleanable)) return "—";
  return cancellable ? (
    <ActionButton
      action={() =>
        api.post(
          `/v1/core/resources/${resourceId}/operations/${operation.id}/actions/cancel`,
        )
      }
      pendingLabel="Cancelling…"
      success="Restore cancellation requested"
      variant="danger"
    >
      Cancel
    </ActionButton>
  ) : (
    <Button size="sm" variant="secondary" onPress={onCleanup}>
      Clean up volume
    </Button>
  );
}

function RestoreCleanupConfirmation({
  onClose,
  operation,
  resourceId,
}: {
  onClose: () => void;
  operation: ResourceOperation | null;
  resourceId: string;
}) {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const result = operation ? readRestoreResult(operation.result) : null;

  function close() {
    setError(undefined);
    onClose();
  }

  async function cleanUp() {
    if (!operation) return;
    setSubmitting(true);
    setError(undefined);
    try {
      await api.post(
        `/v1/core/resources/${resourceId}/actions/restore-cleanup`,
        { restoreId: operation.id },
        { "Idempotency-Key": crypto.randomUUID() },
      );
      toast.success("Rollback volume cleanup queued");
      refreshApiQueries();
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Cleanup failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={Boolean(operation)}
      onOpenChange={(open) => {
        if (!open && !submitting) close();
      }}
    >
      <Modal.Backdrop>
        <Modal.Container size="md">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>Clean up rollback volume?</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="grid gap-5">
              <Alert status="danger">
                <Alert.Indicator />
                <Alert.Content>
                  <Alert.Title>
                    This removes the retained database volume
                  </Alert.Title>
                  <Alert.Description>
                    The promoted database stays active, but Towbar can no longer
                    roll back to the previous volume after cleanup.
                  </Alert.Description>
                </Alert.Content>
              </Alert>
              <p className="text-muted typography--body-sm">
                {result?.previousVolumes.length ?? 0} previous volume
                {(result?.previousVolumes.length ?? 0) === 1 ? "" : "s"} will be
                removed.
              </p>
              {error ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Couldn&apos;t queue cleanup</Alert.Title>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  isDisabled={submitting}
                  variant="secondary"
                  onPress={close}
                >
                  Keep rollback volume
                </Button>
                <Button
                  isDisabled={submitting}
                  variant="danger"
                  onPress={cleanUp}
                >
                  {submitting ? "Queueing cleanup…" : "Clean up volume"}
                </Button>
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function CopyBackupKey({ backup }: { backup: SourceBackup }) {
  async function copyObjectKey() {
    try {
      await navigator.clipboard.writeText(backup.result.key);
      toast.success("S3 object key copied");
    } catch {
      toast.danger("Couldn't copy the S3 object key");
    }
  }
  return (
    <span className="flex min-h-7 flex-wrap items-center gap-x-3 gap-y-1">
      <span>{formatDate(backup.finishedAt ?? backup.createdAt)}</span>
      <button
        className="focus-visible:ring-focus relative inline-flex min-h-7 items-center rounded-md font-medium underline-offset-4 outline-none after:absolute after:-inset-x-1 after:-inset-y-2 after:content-[''] pointer-fine:hover:underline focus-visible:ring-2"
        type="button"
        onClick={copyObjectKey}
      >
        Copy S3 key
      </button>
    </span>
  );
}

function readRestoreResult(result: ResourceOperation["result"]) {
  if (!result || !("outcome" in result)) return null;
  return result as RestoreResult;
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function formatEngine(engine: "postgres" | "redis" | undefined) {
  if (engine === "postgres") return "PostgreSQL";
  if (engine === "redis") return "Redis";
  return "Unknown";
}

function formatBackupFormat(format: SourceBackup["result"]["format"]) {
  if (format === "postgres-custom") return "PostgreSQL custom";
  if (format === "redis-rdb") return "Redis RDB";
  return "Metadata missing";
}

function formatPhase(phase: string | null) {
  if (!phase) return "Queued";
  return phase
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
