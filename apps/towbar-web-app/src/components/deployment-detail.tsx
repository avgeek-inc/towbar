"use client";
import { displayTime } from "@/lib/date-time-display";
import { useAccess } from "./access-context";
import { DeploymentEnvironmentChip } from "./deployment-environment-chip";
import {
  Activity01Icon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowRight02Icon,
  DashboardCircleIcon,
  CubeIcon,
  FileViewIcon,
  GitBranchIcon,
  GitPullRequestIcon,
  InformationSquareIcon,
  ReloadIcon,
  Rocket01Icon,
  SecurityCheckIcon,
  ServerStack01Icon,
  StopCircleIcon,
} from "@hugeicons/core-free-icons";

import { DeploymentDuration } from "./elapsed-time";
import { DeploymentProgress } from "./deployment-progress";

import { DomainLink } from "./domain-link";

import { HugeiconsIcon } from "@hugeicons/react";
import { useParams, useRouter } from "next/navigation";
import type {
  Deployment,
  DeploymentPullRequest,
  Source,
} from "@workspace/towbar-web-client";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Alert } from "@workspace/web-design-system/feedback/alert";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";
import type { BreadcrumbAncestors } from "@workspace/web-page-sections/page";
import { CodePanel } from "@workspace/towbar-web-ui/code-panel";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import {
  ActionButton,
  appsBreadcrumb,
  DashboardPage,
  InlineLink,
  PageTabs,
  resourcesBreadcrumb,
} from "@/components/page-parts";
import { useDeploymentStream } from "@/hooks/use-deployment-stream";
import { useDetailNavigation } from "@/hooks/use-detail-navigation";
import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { deploymentHref } from "@/lib/deployment-route";
import { formatDate } from "./dashboard-overview";
import {
  DeploymentTriggerChip,
  deploymentStatusTooltip,
} from "./deployment-table";
import { DeploymentVulnerabilities } from "./deployment-vulnerability-scan";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";

const terminal = new Set([
  "cancelled",
  "failed",
  "skipped",
  "succeeded",
  "succeeded_with_warnings",
]);
export function DeploymentDetail() {
  const { can } = useAccess();
  const { appId, deploymentId, resourceId } = useParams<{
    appId?: string;
    deploymentId: string;
    resourceId?: string;
  }>();
  const router = useRouter();
  const detail = useDetailNavigation();
  const stream = useDeploymentStream(deploymentId);
  const source = useApiQuery<{ source: Source }>(
    stream.deployment ? `/v1/core/sources/${stream.deployment.sourceId}` : null,
  );
  const revision = useApiQuery<{ pullRequest: DeploymentPullRequest | null }>(
    stream.deployment
      ? `/v1/core/deployments/${deploymentId}/source-revision`
      : null,
  );
  const deployable = useApiQuery<{
    app?: { name: string; serverIp: string };
    resource?: { name: string; serverIp: string };
  }>(
    stream.deployment
      ? `/v1/core/${stream.deployment.deployableKind === "app" ? "apps" : "resources"}/${stream.deployment.appId}`
      : null,
  );
  const routeDeployableKind = appId
    ? "app"
    : resourceId
      ? "resource"
      : undefined;
  const deploymentDeployableKind = stream.deployment
    ? stream.deployment.deployableKind === "app"
      ? "app"
      : "resource"
    : routeDeployableKind;
  const deployableSection =
    deploymentDeployableKind === "resource" ? "resources" : "apps";
  const deployableBreadcrumb =
    deploymentDeployableKind === "resource"
      ? resourcesBreadcrumb
      : appsBreadcrumb;
  const deployableName =
    deployable.data?.app?.name ?? deployable.data?.resource?.name;
  const serverIp =
    deployable.data?.app?.serverIp ?? deployable.data?.resource?.serverIp;
  const breadcrumbAncestors = (
    stream.deployment && deployableName
      ? [
          ...deployableBreadcrumb,
          {
            href: `/${deployableSection}/${stream.deployment.appId}`,
            label: deployableName,
          },
        ]
      : deployableBreadcrumb
  ) as BreadcrumbAncestors;
  if (stream.error && !stream.deployment)
    return (
      <DashboardPage
        icon={Rocket01Icon}
        breadcrumbAncestors={deployableBreadcrumb}
        title="Deployment"
      >
        <QueryError message={stream.error} />
      </DashboardPage>
    );
  if (!stream.deployment || !stream.steps || !stream.logs)
    return (
      <DashboardPage
        icon={Rocket01Icon}
        breadcrumbAncestors={deployableBreadcrumb}
        title="Deployment"
      >
        <QueryLoading />
      </DashboardPage>
    );

  const item = stream.deployment;
  const repository = source.data?.source;
  const commitUrl =
    repository?.repositoryOwner && repository.repositoryName && item.commitSha
      ? `https://github.com/${encodeURIComponent(repository.repositoryOwner)}/${encodeURIComponent(repository.repositoryName)}/commit/${encodeURIComponent(item.commitSha)}`
      : undefined;
  const displayStatus = getDeploymentDisplayStatus(item);
  const routeDeployableId = appId ?? resourceId;
  if (
    routeDeployableId !== item.appId ||
    routeDeployableKind !== deploymentDeployableKind
  ) {
    return (
      <DashboardPage
        icon={Rocket01Icon}
        breadcrumbAncestors={deployableBreadcrumb}
        title="Deployment"
      >
        <QueryError
          message={`This Deployment does not belong to the selected ${routeDeployableKind === "resource" ? "Resource" : "App"}.`}
          retryable={false}
        />
      </DashboardPage>
    );
  }
  const actions = !can("deployment.create") ? undefined : !terminal.has(
      item.state,
    ) ? (
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
      <HugeiconsIcon
        aria-hidden="true"
        icon={StopCircleIcon}
        className="size-4 shrink-0"
      />
      Cancel
    </ActionButton>
  ) : item.environment === "production" &&
    (item.state === "failed" || item.state === "cancelled") ? (
    <ActionButton
      confirm={{
        title: "Retry this deployment?",
        description:
          "Queue another deployment attempt. A successful attempt may replace the running release.",
        actionLabel: "Retry deployment",
      }}
      action={() =>
        api.post<{ deployment: Deployment }>(
          `/v1/core/deployments/${deploymentId}/actions/retry`,
          undefined,
          { "Idempotency-Key": crypto.randomUUID() },
        )
      }
      onSuccess={(result) => router.push(deploymentHref(result.deployment))}
      pendingLabel="Queueing…"
      success="Retry queued"
      variant="primary"
    >
      <HugeiconsIcon
        aria-hidden="true"
        icon={ReloadIcon}
        className="size-4 shrink-0"
      />
      Retry
    </ActionButton>
  ) : undefined;

  const progressSteps = stream.steps.filter(
    (step) => !terminal.has(step.state),
  );
  const sectionTitles: Record<string, string> = {
    logs: "Logs",
    overview: "Overview",
    progress: "Progress",
    vulnerabilities: "Vulnerabilities",
  };
  const activeSectionTitle =
    (detail.section && sectionTitles[detail.section]) ??
    (terminal.has(item.state) ? "Overview" : "Progress");
  const criticalVulnerabilities =
    (item.vulnerabilityScan?.severityTotals.critical ?? 0) +
    (item.vulnerabilityScan?.severityTotals.high ?? 0);

  return (
    <DashboardPage
      icon={Rocket01Icon}
      actions={actions}
      badge={
        <StatusBadge
          status={displayStatus}
          tooltip={deploymentStatusTooltip(item)}
        />
      }
      breadcrumbAncestors={breadcrumbAncestors}
      breadcrumbLabel={activeSectionTitle}
      title={deployableName ? `${deployableName} deployment` : "Deployment"}
    >
      {item.errorMessage ? (
        <Widget className="min-w-0" role="alert">
          <Widget.Header>
            <Widget.Title
              help={false}
              icon={
                <HugeiconsIcon
                  icon={
                    item.state === "succeeded_with_warnings"
                      ? Alert02Icon
                      : item.state === "skipped"
                        ? InformationSquareIcon
                        : item.state === "cancelled"
                          ? StopCircleIcon
                          : AlertCircleIcon
                  }
                />
              }
              className={
                item.state === "succeeded_with_warnings"
                  ? "text-warning-soft-foreground"
                  : item.state === "skipped" || item.state === "cancelled"
                    ? "text-muted"
                    : "text-danger-soft-foreground"
              }
            >
              {item.state === "succeeded_with_warnings"
                ? "Deployment warning"
                : item.state === "skipped"
                  ? "Deployment superseded"
                  : item.state === "cancelled"
                    ? "Deployment cancelled"
                    : "Deployment failed"}
            </Widget.Title>
          </Widget.Header>
          <Widget.Content>
            <p className="text-sm break-words text-foreground">
              {item.errorMessage}
            </p>
          </Widget.Content>
          {item.errorCode ||
          (stream.logs.length > 0 && activeSectionTitle !== "Logs") ? (
            <Widget.Footer>
              {item.errorCode ? (
                <Widget.FooterDescription>
                  Error code:{" "}
                  <code className="break-all">{item.errorCode}</code>
                </Widget.FooterDescription>
              ) : null}
              {stream.logs.length > 0 && activeSectionTitle !== "Logs" ? (
                <InlineLink
                  href={deploymentHref(item, "logs")}
                  className="inline-flex shrink-0 items-center gap-1 text-xs !text-accent !underline"
                >
                  View logs
                  <HugeiconsIcon
                    aria-hidden="true"
                    icon={ArrowRight02Icon}
                    className="size-3.5"
                  />
                </InlineLink>
              ) : null}
            </Widget.Footer>
          ) : null}
        </Widget>
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
              <div className="content-grid">
                <div className="content-grid lg:grid-cols-2">
                  <Attributes
                    icon={<HugeiconsIcon icon={Rocket01Icon} />}
                    columns={2}
                    title="Deployment"
                    variant="card"
                  >
                    <Attributes.Item label="Action">
                      {item.kind === "rollback" ? "Rollback" : "Deploy"}
                    </Attributes.Item>
                    <Attributes.Item label="Environment">
                      <DeploymentEnvironmentChip deployment={item} />
                    </Attributes.Item>
                    <Attributes.Item label="Trigger">
                      <DeploymentTriggerChip trigger={item.trigger} />
                    </Attributes.Item>
                    <Attributes.Item label="Requested">
                      {formatDate(item.createdAt)}
                    </Attributes.Item>
                    <Attributes.Item label="Started">
                      {item.startedAt ? formatDate(item.startedAt) : "Waiting"}
                    </Attributes.Item>
                    <Attributes.Item label="Duration">
                      <DeploymentDuration deployment={item} />
                    </Attributes.Item>
                    <Attributes.Item label="Finished">
                      {item.finishedAt
                        ? formatDate(item.finishedAt)
                        : "Not finished"}
                    </Attributes.Item>
                  </Attributes>
                  <Attributes
                    icon={<HugeiconsIcon icon={ServerStack01Icon} />}
                    columns={2}
                    title="Target"
                    variant="card"
                  >
                    <Attributes.Item
                      icon={
                        <HugeiconsIcon
                          icon={
                            item.deployableKind === "app"
                              ? DashboardCircleIcon
                              : CubeIcon
                          }
                        />
                      }
                      label={item.deployableKind === "app" ? "App" : "Resource"}
                    >
                      <InlineLink
                        href={
                          item.deployableKind === "app"
                            ? `/apps/${item.appId}`
                            : `/resources/${item.appId}`
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
                      <InlineLink href={`/servers/${item.serverId}`}>
                        {serverIp ?? (
                          <TypographyCode>{item.serverId}</TypographyCode>
                        )}
                      </InlineLink>
                    </Attributes.Item>
                    <Attributes.Item label="Commit">
                      {commitUrl ? (
                        <InlineLink
                          href={commitUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`View commit ${item.commitSha} on GitHub (opens in a new tab)`}
                        >
                          <TypographyCode title={item.commitSha}>
                            {item.commitSha.slice(0, 12)}
                          </TypographyCode>
                        </InlineLink>
                      ) : (
                        <TypographyCode title={item.commitSha}>
                          {item.commitSha.slice(0, 12)}
                        </TypographyCode>
                      )}
                    </Attributes.Item>
                    {item.gitRef ? (
                      <Attributes.Item label="Git ref">
                        <TypographyCode>{item.gitRef}</TypographyCode>
                      </Attributes.Item>
                    ) : null}
                    {item.hostname ? (
                      <Attributes.Item label="URL">
                        <DomainLink domain={item.hostname}>
                          {item.hostname}
                        </DomainLink>
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
                    <Attributes.Item label="Repository inputs">
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
                {revision.data?.pullRequest ? (
                  <Attributes
                    icon={<HugeiconsIcon icon={GitPullRequestIcon} />}
                    columns={3}
                    title="Pull request"
                    variant="card"
                  >
                    <Attributes.Item label="Pull request">
                      <InlineLink
                        aria-label={`Open pull request ${revision.data.pullRequest.number} on GitHub (opens in a new tab)`}
                        href={revision.data.pullRequest.url}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        PR #{revision.data.pullRequest.number}
                      </InlineLink>
                    </Attributes.Item>
                    <Attributes.Item label="Title">
                      {revision.data.pullRequest.title}
                    </Attributes.Item>
                    <Attributes.Item label="Status">
                      <Chip
                        size="small"
                        tooltip={pullRequestStateTooltip(
                          revision.data.pullRequest,
                        )}
                        variant={
                          revision.data.pullRequest.state === "open" &&
                          !revision.data.pullRequest.draft
                            ? "success"
                            : "secondary"
                        }
                      >
                        {revision.data.pullRequest.merged
                          ? "Merged"
                          : revision.data.pullRequest.draft
                            ? "Draft"
                            : revision.data.pullRequest.state === "open"
                              ? "Open"
                              : "Closed"}
                      </Chip>
                    </Attributes.Item>
                    <Attributes.Item
                      icon={<HugeiconsIcon icon={GitBranchIcon} />}
                      label="Branches"
                    >
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <TypographyCode className="truncate">
                          {revision.data.pullRequest.headBranch}
                        </TypographyCode>
                        <span aria-hidden="true" className="text-muted">
                          →
                        </span>
                        <TypographyCode className="truncate">
                          {revision.data.pullRequest.baseBranch}
                        </TypographyCode>
                      </span>
                    </Attributes.Item>
                    <Attributes.Item label="Author">
                      {revision.data.pullRequest.author
                        ? `@${revision.data.pullRequest.author}`
                        : "Unknown"}
                    </Attributes.Item>
                    <Attributes.Item label="Changes">
                      {revision.data.pullRequest.changedFileCount}{" "}
                      {revision.data.pullRequest.changedFileCount === 1
                        ? "file"
                        : "files"}
                    </Attributes.Item>
                  </Attributes>
                ) : null}
              </div>
            ),
          },
          {
            value: "progress",
            label: "Progress",
            icon: <HugeiconsIcon icon={Activity01Icon} />,
            content: (
              <div className="content-grid min-w-0">
                {terminal.has(item.state) && progressSteps.length < 2 ? (
                  <Widget>
                    <Widget.Header>
                      <Widget.Title
                        icon={<HugeiconsIcon icon={InformationSquareIcon} />}
                        help={false}
                      >
                        Limited Progress History
                      </Widget.Title>
                    </Widget.Header>
                    <Widget.Content>
                      <p className="text-sm text-foreground">
                        This deployment completed without recording its full
                        execution timeline. The final status and available logs
                        remain authoritative.
                      </p>
                    </Widget.Content>
                  </Widget>
                ) : null}
                <Widget className="min-w-0">
                  <Widget.Header
                    endContent={<StatusBadge status={stream.connection} />}
                  >
                    <Widget.Title
                      icon={<HugeiconsIcon icon={Activity01Icon} />}
                    >
                      Progress
                    </Widget.Title>
                  </Widget.Header>
                  <Widget.Content className="p-2">
                    <DeploymentProgress
                      deployment={item}
                      steps={progressSteps}
                      hasLogs={stream.logs.length > 0}
                    />
                  </Widget.Content>
                </Widget>
              </div>
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
          ...(item.vulnerabilityScanningEnabled || item.vulnerabilityScan
            ? [
                {
                  value: "vulnerabilities",
                  label: "Vulnerabilities",
                  icon: (
                    <HugeiconsIcon
                      icon={SecurityCheckIcon}
                      className="size-4"
                    />
                  ),
                  indicator: criticalVulnerabilities
                    ? {
                        label: String(criticalVulnerabilities),
                        ariaLabel: `${criticalVulnerabilities} critical or high vulnerabilit${criticalVulnerabilities === 1 ? "y" : "ies"}`,
                      }
                    : undefined,
                  content: <DeploymentVulnerabilities deployment={item} />,
                },
              ]
            : []),
        ]}
      />
    </DashboardPage>
  );
}

function formatTime(value: string) {
  return displayTime(value);
}

function pullRequestStateTooltip(pullRequest: DeploymentPullRequest) {
  if (pullRequest.merged)
    return `Merged from ${pullRequest.headBranch} into ${pullRequest.baseBranch}.`;
  if (pullRequest.draft)
    return `Draft pull request from ${pullRequest.headBranch} into ${pullRequest.baseBranch}.`;
  if (pullRequest.state === "open")
    return `Open pull request from ${pullRequest.headBranch} into ${pullRequest.baseBranch}.`;
  return `Closed without merging into ${pullRequest.baseBranch}.`;
}
