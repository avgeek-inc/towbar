"use client";

import {
  AlertCircleIcon,
  CheckmarkCircle01Icon,
  Key01Icon,
  Rocket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import type {
  Deployment,
  InstanceSecretReadiness,
} from "@workspace/towbar-web-client";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { Widget } from "@workspace/web-design-system/data-display/widget";

import { useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { deploymentHref } from "@/lib/deployment-route";
import { ActionButton } from "./page-parts";

export function FirstDeployment({
  canDeploy,
  deployableId,
  type,
}: {
  canDeploy: boolean;
  deployableId: string;
  type: "app" | "resource";
}) {
  const router = useRouter();
  const plural = type === "app" ? "apps" : "resources";
  const readiness = useApiQuery<InstanceSecretReadiness>(
    `/v1/core/${plural}/${deployableId}/secrets/readiness`,
  );
  const settingsHref = `/${type === "app" ? "services" : "datastores"}/${deployableId}/settings/secrets`;

  return (
    <Widget className="min-w-0">
      <Widget.Header>
        <Widget.Title icon={<HugeiconsIcon icon={Rocket01Icon} />}>
          Deployment Status
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="flex min-h-36 items-center">
        {!readiness.data ? (
          <div className="grid gap-1">
            <p>
              {readiness.error
                ? "Secret status unavailable"
                : "Checking required secrets…"}
            </p>
            <p className="text-sm text-muted">
              {readiness.error
                ? "Review the required values before starting the first deployment."
                : "Towbar is checking whether this workload can be deployed."}
            </p>
            {readiness.error ? (
              <ButtonLink
                className="mt-3 w-fit"
                href={settingsHref}
                variant="secondary"
              >
                Review secrets
              </ButtonLink>
            ) : null}
          </div>
        ) : readiness.data.ready ? (
          <div className="flex w-full flex-wrap items-center gap-4">
            <span className="bg-success-soft text-success-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
              <HugeiconsIcon icon={CheckmarkCircle01Icon} className="size-5" />
            </span>
            <div className="min-w-48 flex-1">
              <p>All secrets are configured</p>
              <p className="text-sm text-muted">
                This {type} is ready for its first deployment.
              </p>
            </div>
            {canDeploy ? (
              <ActionButton
                action={() =>
                  api.post<{ deployment: Deployment }>(
                    `/v1/core/${plural}/${deployableId}/actions/deploy`,
                    undefined,
                    { "Idempotency-Key": crypto.randomUUID() },
                  )
                }
                confirm={{
                  title: `Deploy this ${type}?`,
                  description:
                    type === "app"
                      ? "Queue the first app deployment."
                      : "Queue the first resource deployment. This will create its managed container.",
                  actionLabel: `Deploy ${type}`,
                }}
                onSuccess={(result) =>
                  router.push(deploymentHref(result.deployment))
                }
                pendingLabel="Queueing…"
                success="Deployment queued"
                variant="primary"
              >
                Deploy
              </ActionButton>
            ) : null}
          </div>
        ) : (
          <div className="flex w-full flex-wrap items-center gap-4">
            <span className="bg-warning-soft text-warning-soft-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
              <HugeiconsIcon icon={AlertCircleIcon} className="size-5" />
            </span>
            <div className="min-w-48 flex-1">
              <p>Deployment paused</p>
              <p className="text-sm text-muted">
                Configure the pending secrets before the first deployment.
              </p>
            </div>
            <ButtonLink href={settingsHref} variant="secondary">
              <HugeiconsIcon
                aria-hidden="true"
                icon={Key01Icon}
                className="size-4"
              />
              Configure secrets
            </ButtonLink>
          </div>
        )}
      </Widget.Content>
    </Widget>
  );
}
