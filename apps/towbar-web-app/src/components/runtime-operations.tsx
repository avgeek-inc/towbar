"use client";

import { PlayIcon, ReloadIcon, StopIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  ResourceOperation,
  RuntimeState,
} from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { ActionButton } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

type DeployableType = "app" | "resource";

export function RuntimeActionToolbar({
  active,
  deployableId,
  runtimeState,
  type,
}: {
  active: boolean;
  deployableId: string;
  runtimeState: RuntimeState;
  type: DeployableType;
}) {
  if (!active) return null;
  const path = type === "app" ? "apps" : "resources";
  const action = (name: "restart" | "start" | "stop") =>
    api.post(`/v1/core/${path}/${deployableId}/actions/${name}`, undefined, {
      "Idempotency-Key": crypto.randomUUID(),
    });

  return (
    <>
      <ActionButton
        action={() => action("start")}
        ariaLabel={`Start ${type}`}
        confirm={{
          actionLabel: `Start ${type}`,
          description:
            "Towbar will start the container using its current deployed configuration.",
          title: `Start this ${type}?`,
        }}
        isIconOnly
        pendingLabel="Queueing start…"
        success="Start queued"
      >
        <HugeiconsIcon aria-hidden="true" icon={PlayIcon} />
      </ActionButton>
      {runtimeState.observedState !== "stopped" ? (
        <ActionButton
          action={() => action("restart")}
          ariaLabel={`Restart ${type}`}
          confirm={{
            actionLabel: `Restart ${type}`,
            description:
              "Towbar will briefly interrupt the running container and start it again using its current deployed configuration.",
            title: `Restart this ${type}?`,
          }}
          isIconOnly
          pendingLabel="Queueing restart…"
          success="Restart queued"
        >
          <HugeiconsIcon aria-hidden="true" icon={ReloadIcon} />
        </ActionButton>
      ) : null}
      {runtimeState.observedState !== "stopped" ? (
        <ActionButton
          action={() => action("stop")}
          ariaLabel={`Stop ${type}`}
          confirm={{
            actionLabel: `Stop ${type}`,
            description:
              "Towbar will stop the running container. It stays stopped until Start, Restart, or a new deployment succeeds.",
            title: `Stop this ${type}?`,
          }}
          isIconOnly
          pendingLabel="Stopping…"
          success="Stop queued"
          variant="danger"
        >
          <HugeiconsIcon aria-hidden="true" icon={StopIcon} />
        </ActionButton>
      ) : null}
    </>
  );
}

export function RuntimeOverview({
  runtimeState,
  type,
}: {
  runtimeState: RuntimeState;
  type: DeployableType;
}) {
  return (
    <div className="grid gap-4">
      {runtimeState.driftStatus === "drifted" ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Configuration changed outside Towbar</Alert.Title>
            <Alert.Description>
              {runtimeState.driftReasons.length ? (
                <ul className="grid list-disc gap-1 ps-5">
                  {runtimeState.driftReasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : (
                `The running container no longer matches this ${type}'s configuration.`
              )}
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <Attributes title="Current state" variant="card">
        <Attributes.Item label="Expected">
          <StatusBadge status={runtimeState.desiredState} />
        </Attributes.Item>
        <Attributes.Item label="Running">
          <StatusBadge status={runtimeState.observedState} />
        </Attributes.Item>
        <Attributes.Item label="Health">
          <StatusBadge status={runtimeState.healthStatus} />
        </Attributes.Item>
        <Attributes.Item label="Configuration">
          <StatusBadge status={runtimeState.driftStatus} />
        </Attributes.Item>
        <Attributes.Item label="Last checked">
          {runtimeState.checkedAt
            ? formatDate(runtimeState.checkedAt)
            : "Not checked yet"}
        </Attributes.Item>
        <Attributes.Item label="Container">
          {runtimeState.observedContainerName ? (
            <TypographyCode>
              {runtimeState.observedContainerName}
            </TypographyCode>
          ) : (
            "Not observed"
          )}
        </Attributes.Item>
        <Attributes.Item label="Image">
          {runtimeState.observedImage ? (
            <TypographyCode className="break-all">
              {runtimeState.observedImage}
            </TypographyCode>
          ) : (
            "Not observed"
          )}
        </Attributes.Item>
      </Attributes>
    </div>
  );
}

export function RuntimeLogs({
  active,
  deployableId,
  type,
}: {
  active: boolean;
  deployableId: string;
  type: DeployableType;
}) {
  const path = type === "app" ? "apps" : "resources";
  const operations = useApiQuery<{ operations: ResourceOperation[] }>(
    `/v1/core/${path}/${deployableId}/operations`,
    5_000,
  );
  if (operations.error) return <QueryError message={operations.error} />;
  if (!operations.data) return <QueryLoading variant="detail" />;

  const latest = operations.data.operations.find(
    (operation) => operation.type === "capture_logs",
  );
  const result = readLogResult(latest?.result);
  const captureLogsButton = active ? (
    <ActionButton
      action={() =>
        api.post(
          `/v1/core/${path}/${deployableId}/actions/logs`,
          { tail: 500 },
          { "Idempotency-Key": crypto.randomUUID() },
        )
      }
      pendingLabel="Queueing…"
      success="Log capture queued"
      variant="primary"
    >
      Capture logs
    </ActionButton>
  ) : null;

  if (!latest) {
    return (
      <EmptyState className="min-h-64 justify-center">
        <EmptyState.Header>
          <EmptyState.Title>No logs captured</EmptyState.Title>
          <EmptyState.Description>
            Capture the latest container output when you need to inspect this
            {` ${type}`}.
          </EmptyState.Description>
        </EmptyState.Header>
        {captureLogsButton ? (
          <EmptyState.Content>{captureLogsButton}</EmptyState.Content>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted typography--body-sm">
          Last requested {formatDate(latest.createdAt)}
        </p>
        {captureLogsButton}
      </div>
      {latest.state === "succeeded" ? (
        result?.logs ? (
          <CodePanel ariaLabel="Captured container logs" language="text">
            {result.logs}
          </CodePanel>
        ) : (
          <EmptyState className="min-h-64 justify-center">
            <EmptyState.Header>
              <EmptyState.Title>No log output returned</EmptyState.Title>
              <EmptyState.Description>
                The container produced no output for this capture.
              </EmptyState.Description>
            </EmptyState.Header>
          </EmptyState>
        )
      ) : (
        <Attributes title="Latest log capture" variant="card">
          <Attributes.Item label="Status">
            <StatusBadge status={latest.state} />
          </Attributes.Item>
          <Attributes.Item label="Requested">
            {formatDate(latest.createdAt)}
          </Attributes.Item>
          <Attributes.Item label="Result">
            {latest.errorMessage ?? "Waiting for the worker"}
          </Attributes.Item>
        </Attributes>
      )}
      {result?.truncated ? (
        <p className="text-muted typography--body-sm">
          Output was truncated to the Towbar log limit.
        </p>
      ) : null}
    </div>
  );
}

function readLogResult(result: ResourceOperation["result"] | undefined) {
  if (!result || !("logs" in result) || typeof result.logs !== "string") {
    return null;
  }
  return { logs: result.logs, truncated: result.truncated };
}

export function formatBytes(value: number) {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KiB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MiB`;
  return `${(value / 1_073_741_824).toFixed(1)} GiB`;
}
