"use client";

import type { Deployment, DeploymentStep } from "@workspace/towbar-web-client";
import { Accordion } from "@workspace/web-design-system/data-display/accordion";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { formatStatus } from "@workspace/towbar-web-ui/status-badge";
import { cn } from "@workspace/web-design-system/lib/utils";
import { displayTime } from "@/lib/date-time-display";
import { deploymentHref } from "@/lib/deployment-route";
import { isEventRunning } from "@/lib/elapsed-time";
import { formatDate } from "./dashboard-overview";
import { ElapsedTime } from "./elapsed-time";
import { InlineLink } from "./page-parts";
import { ProgressChecklistItem } from "./progress-checklist";

export function DeploymentProgress({
  deployment,
  steps,
  hasLogs,
}: {
  deployment: Deployment;
  steps: DeploymentStep[];
  hasLogs: boolean;
}) {
  const live = isEventRunning({ ...deployment, status: deployment.state });
  const terminalStatus =
    deployment.state === "failed" ||
    deployment.state === "cancelled" ||
    deployment.state === "skipped" ||
    deployment.state === "succeeded"
      ? deployment.state
      : deployment.state === "succeeded_with_warnings"
        ? "succeeded"
        : undefined;
  return (
    <Accordion
      aria-label="Deployment progress"
      allowsMultipleExpanded
      hideSeparator
      className="grid gap-2"
    >
      {steps.map((step) => {
        const status =
          step.status === "running"
            ? (terminalStatus ?? step.status)
            : step.status;
        const finishedAt =
          step.finishedAt ??
          (step.status === "running" ? deployment.finishedAt : null);
        return (
          <ProgressChecklistItem
            key={step.id}
            id={step.id}
            title={formatStatus(step.state)}
            status={status}
            description={
              step.startedAt ? (
                <span className="inline-flex flex-wrap items-center gap-x-2">
                  <TooltipText
                    as="time"
                    className="tabular-nums"
                    dateTime={step.startedAt}
                    tooltip={formatDate(step.startedAt)}
                  >
                    {displayTime(step.startedAt)}
                  </TooltipText>
                  <span aria-hidden="true">·</span>
                  <span>
                    Duration:{" "}
                    <ElapsedTime
                      startedAt={step.startedAt}
                      finishedAt={finishedAt}
                      status={live ? step.status : "succeeded"}
                    />
                  </span>
                </span>
              ) : status === "waiting" ? (
                "Waiting for this step to start."
              ) : (
                "Start time was not recorded."
              )
            }
          >
            {step.message ? (
              <p
                className={cn(
                  "text-sm break-words",
                  status === "failed"
                    ? "text-danger-soft-foreground"
                    : "text-muted",
                )}
              >
                {step.message}
              </p>
            ) : null}
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted">Started</dt>
                <dd className="text-foreground">
                  {step.startedAt ? formatDate(step.startedAt) : "Not recorded"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Finished</dt>
                <dd className="text-foreground">
                  {finishedAt
                    ? formatDate(finishedAt)
                    : status === "running"
                      ? "In progress"
                      : "Not recorded"}
                </dd>
              </div>
            </dl>
            {hasLogs ? (
              <InlineLink
                href={deploymentHref(deployment, "logs")}
                className="w-fit text-xs text-accent underline"
              >
                View deployment logs
              </InlineLink>
            ) : null}
          </ProgressChecklistItem>
        );
      })}
    </Accordion>
  );
}
