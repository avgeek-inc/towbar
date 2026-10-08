"use client";

import type { Deployment, DeploymentStep } from "@workspace/towbar-web-client";
import { Accordion } from "@avgeek-oss/design-system/data-display/accordion";
import { TooltipText } from "@avgeek-oss/design-system/overlays/tooltip";
import { formatStatus } from "@workspace/towbar-web-ui/status-badge";
import { cn } from "@avgeek-oss/design-system/lib/utils";
import { displayTime } from "@/lib/date-time-display";
import { deploymentHref } from "@/lib/deployment-route";
import {
  deploymentProgressStages,
  type ProgressStep,
} from "@/lib/deployment-progress-stages";
import { getDeploymentDisplayStatus } from "@/lib/deployment-status";
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
  const stages = deploymentProgressStages(deployment, steps);
  const waiting =
    deployment.state === "queued" || deployment.state === "waiting_for_server";
  return (
    <div className="grid gap-3">
      {waiting ? (
        <p className="text-sm text-muted" role="status">
          {formatStatus(getDeploymentDisplayStatus(deployment))}
        </p>
      ) : null}
      <Accordion
        aria-label="Deployment progress"
        allowsMultipleExpanded
        hideSeparator
        className="grid gap-2"
      >
        {stages.map((stage) => (
          <ProgressChecklistItem
            key={stage.id}
            id={stage.id}
            title={stage.title}
            status={stage.status}
            runningTone="warning"
            description={
              <ProgressTiming
                {...stage}
                waitingText={
                  deployment.finishedAt ? "No recorded steps." : undefined
                }
              />
            }
          >
            <Accordion
              aria-label={`${stage.title} details`}
              allowsMultipleExpanded
              hideSeparator
              className="grid gap-2"
            >
              {stage.steps.map((step) => (
                <DeploymentStepProgress
                  key={step.id}
                  deployment={deployment}
                  step={step}
                  hasLogs={hasLogs}
                />
              ))}
            </Accordion>
          </ProgressChecklistItem>
        ))}
      </Accordion>
    </div>
  );
}

function DeploymentStepProgress({
  deployment,
  step,
  hasLogs,
}: {
  deployment: Deployment;
  step: ProgressStep;
  hasLogs: boolean;
}) {
  const { status, finishedAt } = step;
  return (
    <ProgressChecklistItem
      key={step.id}
      id={step.id}
      title={formatStatus(step.state)}
      status={status}
      runningTone="warning"
      description={<ProgressTiming {...step} />}
    >
      {step.message ? (
        <p
          className={cn(
            "text-xs break-words",
            status === "failed" ? "text-danger-soft-foreground" : "text-muted",
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
        {finishedAt ? (
          <div>
            <dt className="text-muted">Finished</dt>
            <dd className="text-foreground">{formatDate(finishedAt)}</dd>
          </div>
        ) : null}
      </dl>
      {hasLogs ? (
        <InlineLink
          href={deploymentHref(deployment, "logs")}
          className="w-fit rounded-sm text-xs text-muted"
        >
          View deployment logs
        </InlineLink>
      ) : null}
    </ProgressChecklistItem>
  );
}

function ProgressTiming({
  startedAt,
  finishedAt,
  status,
  waitingText = "Waiting to start.",
}: {
  startedAt: string | null;
  finishedAt: string | null;
  status: ProgressStep["status"];
  waitingText?: string;
}) {
  return startedAt ? (
    <span className="inline-flex items-center gap-x-1">
      <TooltipText
        as="time"
        className="tabular-nums"
        dateTime={startedAt}
        tooltip={formatDate(startedAt)}
      >
        {displayTime(startedAt)}
      </TooltipText>
      <span>
        (
        <ElapsedTime
          startedAt={startedAt}
          finishedAt={finishedAt}
          status={status}
        />
        )
      </span>
    </span>
  ) : status === "waiting" ? (
    <>{waitingText}</>
  ) : (
    <>Start time was not recorded.</>
  );
}
