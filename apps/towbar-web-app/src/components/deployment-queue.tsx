"use client";

import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";

import { GitBranchIcon, Rocket01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  App,
  Deployment,
  DeploymentState,
  Resource,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { ProgressCircle } from "@workspace/web-design-system/feedback/progress-circle";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { Popover } from "@workspace/web-design-system/overlays/popover";
import { ScrollShadow } from "@workspace/web-design-system/utilities/scroll-shadow";
import { formatStatus } from "@workspace/towbar-web-ui/status-badge";

import { useApiQuery } from "@/hooks/use-api-query";
import { deploymentHref } from "@/lib/deployment-route";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";
import { DeploymentEnvironmentChip } from "./deployment-environment-chip";

const terminalDeploymentStates = new Set<DeploymentState>([
  "cancelled",
  "failed",
  "skipped",
  "succeeded",
  "succeeded_with_warnings",
]);

const waitingDeploymentStates = new Set<DeploymentState>([
  "queued",
  "waiting_for_server",
]);

function queueBlockerLabel(deployment: Deployment) {
  switch (deployment.queueBlocker) {
    case "server_capacity":
      return "Waiting for server capacity";
    case "server_check":
      return "Waiting for a server check";
    case "server_operation":
      return "Waiting for a server operation";
    case "server_preparation":
      return "Waiting for server setup";
    default:
      return deployment.state === "waiting_for_server"
        ? "Waiting for the server"
        : null;
  }
}

function DeploymentStateIndicator({ deployment }: { deployment: Deployment }) {
  const isWaiting = waitingDeploymentStates.has(deployment.state);

  return (
    <span className="flex shrink-0 items-center gap-2">
      {isWaiting ? (
        <span
          aria-hidden="true"
          className="size-3.5 shrink-0 rounded-full border-2 border-warning"
        />
      ) : (
        <ProgressCircle
          aria-label="Deployment in progress"
          color="accent"
          isIndeterminate
          size="sm"
        >
          <ProgressCircle.Track>
            <ProgressCircle.TrackCircle />
            <ProgressCircle.FillCircle />
          </ProgressCircle.Track>
        </ProgressCircle>
      )}
      <span className="typography--body-sm text-muted">
        {formatStatus(getDeploymentDisplayStatus(deployment))}
      </span>
    </span>
  );
}

export function DeploymentQueue({ inline = false }: { inline?: boolean }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const apps = useApiQuery<{ apps: App[] }>("/v1/core/apps");
  const resources = useApiQuery<{ resources: Resource[] }>(
    "/v1/core/resources",
  );
  const deployments = useApiQuery<{ deployments: Deployment[] }>(
    "/v1/core/deployments",
    5_000,
  );
  const pending = useMemo(
    () =>
      (deployments.data?.deployments ?? []).filter(
        (deployment) => !terminalDeploymentStates.has(deployment.state),
      ),
    [deployments.data],
  );
  const deployableNames = useMemo(
    () =>
      new Map([
        ...(apps.data?.apps ?? []).map((app) => [app.id, app.name] as const),
        ...(resources.data?.resources ?? []).map(
          (resource) => [resource.id, resource.name] as const,
        ),
      ]),
    [apps.data, resources.data],
  );

  if (!deployments.data || deployments.error || pending.length === 0)
    return null;

  function openDeployment(deployment: Deployment) {
    setIsOpen(false);
    router.push(deploymentHref(deployment));
  }

  return (
    <div
      className={
        inline
          ? "relative"
          : "fixed right-4 bottom-4 z-(--z-sticky) sm:right-6 sm:bottom-6"
      }
    >
      <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
        <Popover.Trigger
          aria-label={`${pending.length} pending deployment${pending.length === 1 ? "" : "s"}. View deployment queue.`}
          className="inline-flex h-8 min-h-8 cursor-pointer items-center gap-2 rounded-full border-transparent bg-default px-3 text-sm text-foreground shadow-none outline-none transition-[color,background-color,transform] hover:bg-default/80 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-focus motion-reduce:transition-none"
        >
          <ProgressCircle
            aria-label="Deployments in progress"
            color="accent"
            isIndeterminate
            size="sm"
          >
            <ProgressCircle.Track>
              <ProgressCircle.TrackCircle />
              <ProgressCircle.FillCircle />
            </ProgressCircle.Track>
          </ProgressCircle>
          <span aria-live="polite" className="whitespace-nowrap tabular-nums">
            {pending.length} pending
          </span>
        </Popover.Trigger>
        <Popover.Content
          className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-transparent p-0"
          offset={8}
          placement={inline ? "bottom end" : "top end"}
        >
          <Popover.Dialog className="overflow-hidden p-0">
            <Widget>
              <Widget.Header>
                <Popover.Heading className="flex min-w-0">
                  <Widget.Title icon={<HugeiconsIcon icon={Rocket01Icon} />}>
                    Deployment queue
                  </Widget.Title>
                </Popover.Heading>
              </Widget.Header>
              <Widget.Content className="p-0">
                <ScrollShadow className="max-h-80" hideScrollBar>
                  <div className="divide-y divide-separator">
                    {pending.map((deployment) => {
                      const deployableName =
                        deployableNames.get(deployment.appId) ??
                        "Unavailable deployable";
                      const blocker = queueBlockerLabel(deployment);
                      return (
                        <Button
                          className="h-auto min-h-16 w-full items-start justify-between gap-4 rounded-none px-4 py-3 text-start"
                          key={deployment.id}
                          variant="ghost"
                          onPress={() => openDeployment(deployment)}
                        >
                          <span className="grid min-w-0 flex-1 gap-0.5">
                            <TooltipText
                              className="min-w-0 truncate"
                              tooltip={deployableName}
                            >
                              {deployableName}
                            </TooltipText>
                            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <DeploymentEnvironmentChip
                                deployment={deployment}
                              />
                              <Chip
                                size="small"
                                variant="secondary"
                                tooltip={`Branch: ${deployment.targetEnvironment.branch}`}
                                icon={<HugeiconsIcon icon={GitBranchIcon} />}
                              >
                                <span className="max-w-32 truncate">
                                  {deployment.targetEnvironment.branch}
                                </span>
                              </Chip>
                            </span>
                          </span>
                          <span className="grid shrink-0 justify-items-end gap-0.5">
                            <DeploymentStateIndicator deployment={deployment} />
                            {blocker ? (
                              <span className="typography--body-xs max-w-48 text-end text-muted">
                                {blocker}
                              </span>
                            ) : null}
                          </span>
                        </Button>
                      );
                    })}
                  </div>
                </ScrollShadow>
              </Widget.Content>
            </Widget>
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
