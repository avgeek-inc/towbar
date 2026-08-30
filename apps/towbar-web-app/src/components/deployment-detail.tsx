"use client";

import {
  Activity01Icon,
  DashboardCircleIcon,
  DatabaseIcon,
  FileViewIcon,
  InformationSquareIcon,
  Rocket01Icon,
  ServerStack01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter } from "next/navigation";
import type { Deployment } from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { Stepper } from "@workspace/web-design-system/navigation/stepper";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import type { BreadcrumbAncestors } from "@workspace/web-page-sections/page";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import {
  formatStatus,
  StatusBadge,
} from "@workspace/towbar-web-ui/status-badge";

import {
  ActionButton,
  DashboardPage,
  InlineLink,
  PageTabs,
} from "@/components/page-parts";
import { useDeploymentStream } from "@/hooks/use-deployment-stream";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";
import { formatDeploymentTrigger } from "./deployment-table";
import { DeploymentVulnerabilityScanPanel } from "./deployment-vulnerability-scan";
import { useSourceBreadcrumbs } from "./source-breadcrumbs";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";

const terminal = new Set([
  "cancelled",
  "failed",
  "skipped",
  "succeeded",
  "succeeded_with_warnings",
]);
export function DeploymentDetail() {
  const { deploymentId, sourceId } = useParams<{
    deploymentId: string;
    sourceId: string;
  }>();
  const router = useRouter();
  const stream = useDeploymentStream(deploymentId);
  const deployable = useApiQuery<{
    app?: { name: string; serverIp: string };
    resource?: { name: string; serverIp: string };
  }>(
    stream.deployment
      ? `/v1/core/${stream.deployment.deployableKind === "app" ? "apps" : "resources"}/${stream.deployment.appId}`
      : null,
  );
  const deployableSection = stream.deployment
    ? stream.deployment.deployableKind === "app"
      ? "apps"
      : "resources"
    : undefined;
  const sourceBreadcrumbAncestors = useSourceBreadcrumbs(
    sourceId,
    deployableSection
      ? {
          href: `/sources/${sourceId}?section=${deployableSection}`,
          label: deployableSection === "apps" ? "Apps" : "Resources",
        }
      : undefined,
  );
  const deployableName =
    deployable.data?.app?.name ?? deployable.data?.resource?.name;
  const serverIp =
    deployable.data?.app?.serverIp ?? deployable.data?.resource?.serverIp;
  const breadcrumbAncestors = (
    stream.deployment && deployableName
      ? [
          ...sourceBreadcrumbAncestors,
          {
            href: `/sources/${sourceId}/${deployableSection}/${stream.deployment.appId}`,
            label: deployableName,
          },
        ]
      : sourceBreadcrumbAncestors
  ) as BreadcrumbAncestors;
  if (stream.error && !stream.deployment)
    return (
      <DashboardPage
        breadcrumbAncestors={sourceBreadcrumbAncestors}
        title="Deployment"
      >
        <QueryError message={stream.error} />
      </DashboardPage>
    );
  if (!stream.deployment || !stream.steps || !stream.logs)
    return (
      <DashboardPage
        breadcrumbAncestors={sourceBreadcrumbAncestors}
        title="Deployment"
      >
        <QueryLoading />
      </DashboardPage>
    );

  const item = stream.deployment;
  const displayStatus = getDeploymentDisplayStatus(item);
  if (item.sourceId !== sourceId) {
    return (
      <DashboardPage
        breadcrumbAncestors={sourceBreadcrumbAncestors}
        title="Deployment"
      >
        <QueryError
          message="This Deployment does not belong to the selected Source."
          retryable={false}
        />
      </DashboardPage>
    );
  }
  const actions = !terminal.has(item.state) ? (
    <ActionButton
      action={() =>
        api.post(`/v1/core/deployments/${deploymentId}/actions/cancel`)
      }
      confirm={{
        actionLabel: "Request cancellation",
        description:
          "The worker will stop at the next safe boundary. A release that has already been promoted will not be reverted.",
        title: "Cancel this deployment?",
      }}
      pendingLabel="Cancelling…"
      success="Cancellation requested"
      variant="danger"
    >
      Cancel
    </ActionButton>
  ) : item.environment === "production" &&
    (item.state === "failed" || item.state === "cancelled") ? (
    <ActionButton
      action={() =>
        api.post<{ deployment: Deployment }>(
          `/v1/core/deployments/${deploymentId}/actions/retry`,
          undefined,
          { "Idempotency-Key": crypto.randomUUID() },
        )
      }
      onSuccess={(result) =>
        router.push(
          `/sources/${item.sourceId}/deployments/${result.deployment.id}`,
        )
      }
      pendingLabel="Queueing…"
      success="Retry queued"
      variant="primary"
    >
      Retry
    </ActionButton>
  ) : undefined;

  const progressSteps = stream.steps.filter(
    (step) => !terminal.has(step.state),
  );
  const currentStep =
    [...progressSteps].reverse().find((step) => step.status === "running") ??
    progressSteps.at(-1);
  const currentStepIndex = Math.max(
    0,
    progressSteps.findIndex((step) => step.id === currentStep?.id),
  );
  const displayedStep = ["succeeded", "succeeded_with_warnings"].includes(
    item.state,
  )
    ? progressSteps.length
    : currentStepIndex;

  return (
    <DashboardPage
      actions={actions}
      badge={<StatusBadge status={displayStatus} />}
      breadcrumbAncestors={breadcrumbAncestors}
      breadcrumbLabel={`Deployment ${item.id.slice(0, 8)}`}
      title={`Deployment ${item.id.slice(0, 8)}`}
      titleContent={
        <span className="inline-flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-6 shrink-0"
            icon={Rocket01Icon}
          />
          <span>Deployment</span>
          <TypographyCode title={item.id}>{item.id.slice(0, 8)}</TypographyCode>
        </span>
      }
    >
      {item.errorMessage ? (
        <Alert
          status={
            item.state === "succeeded_with_warnings"
              ? "warning"
              : item.state === "skipped"
                ? "default"
                : "danger"
          }
        >
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>
              {item.errorCode ? (
                <TypographyCode>{item.errorCode}</TypographyCode>
              ) : item.state === "succeeded_with_warnings" ? (
                "Deployment warning"
              ) : item.state === "skipped" ? (
                "Deployment superseded"
              ) : (
                "Deployment failed"
              )}
            </Alert.Title>
            <Alert.Description>{item.errorMessage}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : stream.connection === "reconnecting" ? (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>Live updates interrupted</Alert.Title>
            <Alert.Description>
              Towbar is reconnecting automatically. The deployment continues on
              the worker.
            </Alert.Description>
          </Alert.Content>
        </Alert>
      ) : null}
      <PageTabs
        defaultValue={terminal.has(item.state) ? "overview" : "progress"}
        tabs={[
          {
            value: "overview",
            label: "Overview",
            icon: <HugeiconsIcon icon={InformationSquareIcon} />,
            content: (
              <div className="grid gap-8">
                <div className="grid gap-8 lg:grid-cols-2">
                  <Attributes columns={2} title="Deployment" variant="card">
                    <Attributes.Item label="Action">
                      {item.kind === "rollback" ? "Rollback" : "Deploy"}
                    </Attributes.Item>
                    <Attributes.Item label="Environment">
                      <StatusBadge status={item.environment} />
                    </Attributes.Item>
                    <Attributes.Item label="Trigger">
                      {formatDeploymentTrigger(item.trigger)}
                    </Attributes.Item>
                    <Attributes.Item label="Requested">
                      {formatDate(item.createdAt)}
                    </Attributes.Item>
                    <Attributes.Item label="Started">
                      {item.startedAt ? formatDate(item.startedAt) : "Waiting"}
                    </Attributes.Item>
                    <Attributes.Item label="Finished">
                      {item.finishedAt
                        ? formatDate(item.finishedAt)
                        : "Not finished"}
                    </Attributes.Item>
                  </Attributes>
                  <Attributes columns={2} title="Target" variant="card">
                    <Attributes.Item
                      icon={
                        <HugeiconsIcon
                          icon={
                            item.deployableKind === "app"
                              ? DashboardCircleIcon
                              : DatabaseIcon
                          }
                        />
                      }
                      label={item.deployableKind === "app" ? "App" : "Resource"}
                    >
                      <InlineLink
                        href={
                          item.deployableKind === "app"
                            ? `/sources/${item.sourceId}/apps/${item.appId}`
                            : `/sources/${item.sourceId}/resources/${item.appId}`
                        }
                      >
                        {deployableName ?? (
                          <TypographyCode>{item.appId}</TypographyCode>
                        )}
                      </InlineLink>
                    </Attributes.Item>
                    <Attributes.Item
                      icon={<HugeiconsIcon icon={ServerStack01Icon} />}
                      label="Server"
                    >
                      <InlineLink
                        href={`/sources/${item.sourceId}/servers/${item.serverId}`}
                      >
                        {serverIp ?? (
                          <TypographyCode>{item.serverId}</TypographyCode>
                        )}
                      </InlineLink>
                    </Attributes.Item>
                    <Attributes.Item label="Commit">
                      <TypographyCode title={item.commitSha}>
                        {item.commitSha.slice(0, 12)}
                      </TypographyCode>
                    </Attributes.Item>
                    {item.gitRef ? (
                      <Attributes.Item label="Git ref">
                        <TypographyCode>{item.gitRef}</TypographyCode>
                      </Attributes.Item>
                    ) : null}
                    {item.hostname ? (
                      <Attributes.Item label="URL">
                        <a
                          className="underline decoration-muted underline-offset-4 hover:decoration-current"
                          href={`https://${item.hostname}`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {item.hostname}
                        </a>
                      </Attributes.Item>
                    ) : null}
                    <Attributes.Item label="Manifest digest">
                      <TypographyCode title={item.manifestDigest}>
                        {item.manifestDigest.slice(0, 12)}
                      </TypographyCode>
                    </Attributes.Item>
                    <Attributes.Item label="Image digest">
                      {item.imageDigest ? (
                        <TypographyCode title={item.imageDigest}>
                          {item.imageDigest.slice(7, 19)}
                        </TypographyCode>
                      ) : (
                        "Not recorded"
                      )}
                    </Attributes.Item>
                    <Attributes.Item label="Image platform">
                      {item.imagePlatform ?? "Not recorded"}
                    </Attributes.Item>
                    <Attributes.Item label="Source inputs">
                      {item.sourceInputDigest ? (
                        <TypographyCode title={item.sourceInputDigest}>
                          {item.sourceInputDigest.slice(0, 12)}
                        </TypographyCode>
                      ) : (
                        "Commit-sensitive"
                      )}
                    </Attributes.Item>
                    <Attributes.Item label="Deployment ID">
                      <TypographyCode title={item.id}>
                        {item.id.slice(0, 8)}
                      </TypographyCode>
                    </Attributes.Item>
                  </Attributes>
                </div>
                <DeploymentVulnerabilityScanPanel deployment={item} />
              </div>
            ),
          },
          {
            value: "progress",
            label: "Progress",
            icon: <HugeiconsIcon icon={Activity01Icon} />,
            content: (
              <Widget className="min-w-0">
                <Widget.Header>
                  <Widget.Title>
                    {formatStatus(currentStep?.state ?? displayStatus)}
                  </Widget.Title>
                  <StatusBadge status={stream.connection} />
                </Widget.Header>
                <Widget.Content>
                  <Stepper
                    aria-label="Deployment progress"
                    currentStep={displayedStep}
                    orientation="vertical"
                    size="sm"
                  >
                    {progressSteps.map((step) => (
                      <Stepper.Step key={step.id}>
                        <Stepper.Indicator />
                        <Stepper.Content>
                          <Stepper.Title>
                            <span className="inline-flex min-w-0 items-center gap-2">
                              <span className="truncate">
                                {formatStatus(step.state)}
                              </span>
                              <StatusBadge status={step.status} />
                            </span>
                          </Stepper.Title>
                          {step.message || step.startedAt ? (
                            <Stepper.Description>
                              <span className="grid gap-1">
                                {step.message ? (
                                  <span>{step.message}</span>
                                ) : null}
                                {step.startedAt ? (
                                  <time
                                    className="tabular-nums"
                                    dateTime={step.startedAt}
                                    title={formatDate(step.startedAt)}
                                  >
                                    {formatTime(step.startedAt)}
                                  </time>
                                ) : null}
                              </span>
                            </Stepper.Description>
                          ) : null}
                        </Stepper.Content>
                        <Stepper.Separator />
                      </Stepper.Step>
                    ))}
                  </Stepper>
                </Widget.Content>
              </Widget>
            ),
          },
          {
            value: "logs",
            label: "Logs",
            icon: <HugeiconsIcon icon={FileViewIcon} />,
            content: stream.logs.length ? (
              <CodePanel ariaLabel="Deployment logs" language="text">
                {stream.logs
                  .map(
                    (log) =>
                      `${formatTime(log.createdAt)} ${log.stream === "stderr" ? "ERR" : "OUT"} ${log.content}`,
                  )
                  .join("\n")}
              </CodePanel>
            ) : (
              <EmptyState>
                <EmptyState.Header>
                  <EmptyState.Title>
                    {terminal.has(item.state)
                      ? "No deployment output"
                      : "Waiting for deployment output"}
                  </EmptyState.Title>
                  <EmptyState.Description>
                    {terminal.has(item.state)
                      ? "The worker completed without producing any log output."
                      : "Worker output will appear here as the deployment progresses."}
                  </EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            ),
          },
        ]}
      />
    </DashboardPage>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
