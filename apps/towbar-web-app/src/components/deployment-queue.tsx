"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  App,
  Deployment,
  DeploymentState,
  Resource,
} from "@workspace/towbar-web-client";
import { Button } from "@workspace/web-design-system/buttons/button";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { ProgressCircle } from "@workspace/web-design-system/feedback/progress-circle";
import { Popover } from "@workspace/web-design-system/overlays/popover";
import { ScrollShadow } from "@workspace/web-design-system/utilities/scroll-shadow";
import { formatStatus } from "@workspace/towbar-web-ui/status-badge";

import { useApiQuery } from "@/hooks/use-api-query";

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

function DeploymentStateIndicator({ state }: { state: DeploymentState }) {
  const isWaiting = waitingDeploymentStates.has(state);

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
        {formatStatus(state)}
      </span>
    </span>
  );
}

export function DeploymentQueue() {
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

  if (!deployments.data || deployments.error) return null;

  function openDeployment(deployment: Deployment) {
    setIsOpen(false);
    router.push(`/sources/${deployment.sourceId}/deployments/${deployment.id}`);
  }

  return (
    <div className="fixed right-4 bottom-4 z-(--z-sticky) sm:right-6 sm:bottom-6">
      <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
        <Button
          aria-label={`${pending.length} pending deployment${pending.length === 1 ? "" : "s"}. View deployment queue.`}
          className="min-h-11 rounded-full bg-overlay shadow-[var(--surface-shadow-sm)]"
          variant="outline"
        >
          <ProgressCircle
            aria-label={
              pending.length
                ? "Deployments in progress"
                : "No deployments in progress"
            }
            color={pending.length ? "accent" : "default"}
            isIndeterminate={pending.length > 0}
            size="sm"
            value={0}
          >
            <ProgressCircle.Track>
              <ProgressCircle.TrackCircle />
              <ProgressCircle.FillCircle />
            </ProgressCircle.Track>
          </ProgressCircle>
          <span aria-live="polite" className="tabular-nums">
            {pending.length} pending
          </span>
        </Button>
        <Popover.Content
          className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden bg-overlay"
          offset={8}
          placement="top end"
        >
          <Popover.Dialog className="overflow-hidden p-0">
            <div className="border-b border-separator px-4 py-3">
              <Popover.Heading>Deployment queue</Popover.Heading>
            </div>
            {pending.length ? (
              <ScrollShadow className="max-h-80" hideScrollBar>
                <div className="divide-y divide-separator">
                  {pending.map((deployment) => {
                    const deployableName =
                      deployableNames.get(deployment.appId) ??
                      "Unavailable deployable";
                    return (
                      <Button
                        className="h-auto min-h-14 w-full justify-between rounded-none bg-overlay px-4 py-3 text-start"
                        key={deployment.id}
                        variant="ghost"
                        onPress={() => openDeployment(deployment)}
                      >
                        <span
                          className="min-w-0 truncate font-medium"
                          title={deployableName}
                        >
                          {deployableName}
                        </span>
                        <DeploymentStateIndicator state={deployment.state} />
                      </Button>
                    );
                  })}
                </div>
              </ScrollShadow>
            ) : (
              <EmptyState className="min-h-32 justify-center">
                <EmptyState.Header>
                  <EmptyState.Title>
                    No deployments in progress
                  </EmptyState.Title>
                  <EmptyState.Description>
                    Queued and active deployments will appear here.
                  </EmptyState.Description>
                </EmptyState.Header>
              </EmptyState>
            )}
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}
