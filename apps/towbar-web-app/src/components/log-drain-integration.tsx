"use client";

import Image from "next/image";
import type { LogDrainHealth } from "@workspace/towbar-core";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";

import { useApiQuery } from "@/hooks/use-api-query";
import { documentationTopics } from "@/lib/documentation";
import { logDrainNames, logDrainStatus } from "@/lib/log-drain-providers";
import { IntegrationProviderLogo } from "./integration-provider-logo";
import { RelativeTime } from "./last-synced-time";
import { PageSelectionTitle } from "./page-selection-title";
import { FormCard } from "./page-parts";

export { logDrainNames } from "@/lib/log-drain-providers";

export type LogDrainProvider = keyof typeof logDrainNames;

export type LogDrainConfiguration = {
  provider: LogDrainProvider;
  revision: string;
  source: "environment";
  state: "enabled";
  apiKeyConfigured?: boolean;
  auth?: string;
  dataset?: string;
  endpoint?: string;
  ingestHost?: string;
  region?: string;
  site?: string;
  tenantId?: string;
  health?: (LogDrainHealth & {
    serverId: string;
    serverName: string;
    checkedAt?: string;
  })[];
};

export type LogDrainState = {
  configurations: LogDrainConfiguration[];
};

const endpoint = "/v1/core/log-drains";

export function LogDrainIntegration({
  provider,
}: {
  provider: LogDrainProvider;
}) {
  const query = useApiQuery<LogDrainState>(endpoint, 30_000);
  const title = (
    <PageSelectionTitle
      label={logDrainNames[provider]}
      icon={<IntegrationProviderLogo provider={provider} className="size-6" />}
    />
  );
  if (query.error)
    return (
      <>
        {title}
        <QueryError message={query.error} />
      </>
    );
  if (!query.data)
    return (
      <>
        {title}
        <QueryLoading />
      </>
    );

  const configuration = query.data.configurations.find(
    (item) => item.provider === provider,
  );
  if (!configuration)
    return (
      <>
        {title}
        <Widget>
          <Widget.Content className="p-0">
            <EmptyState>
              <EmptyState.Media>
                <Image
                  src="/mascots/missing-configuration.webp"
                  alt=""
                  width={120}
                  height={120}
                  className="size-24 object-contain md:size-30"
                />
              </EmptyState.Media>
              <EmptyState.Header>
                <EmptyState.Title>
                  Credentials are not configured yet.
                </EmptyState.Title>
                <EmptyState.Description>
                  Configure {logDrainNames[provider]} in the Towbar runtime to
                  forward logs here.
                </EmptyState.Description>
              </EmptyState.Header>
              <EmptyState.Content>
                <ButtonLink
                  href={documentationTopics.logDrains.href}
                  rel="noopener noreferrer"
                  target="_blank"
                  variant="secondary"
                >
                  Open documentation <NewTabIndicator />
                </ButtonLink>
              </EmptyState.Content>
            </EmptyState>
          </Widget.Content>
        </Widget>
      </>
    );

  const unhealthy = (configuration.health ?? []).filter(
    (item) => item.status !== "configured",
  );

  const health = configuration.health ?? [];
  const accepted = health.reduce(
    (count, item) => count + item.acceptedBatches,
    0,
  );
  const dropped = health.reduce(
    (count, item) => count + item.droppedBatches,
    0,
  );
  const total = accepted + dropped;
  const publicSettings = [
    ["Region", configuration.region],
    ["Site", configuration.site],
    ["Dataset", configuration.dataset],
    ["Ingest host", configuration.ingestHost],
    ["Endpoint", configuration.endpoint],
    ["Authentication", configuration.auth],
    ["Tenant ID", configuration.tenantId],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <>
      {title}
      <div className="content-grid lg:grid-cols-2 lg:items-start">
        <FormCard
          title="Runtime configuration"
          help={false}
          headerEnd={<StatusBadge {...logDrainStatus(configuration)} />}
        >
          <div className="grid gap-4">
            <div className="grid gap-3">
              <p className="text-sm text-muted">
                Credentials are configured in the Towbar runtime. Select this
                provider in an app or resource manifest to forward its logs.
              </p>
              {publicSettings.length ? (
                <dl className="grid gap-2 text-sm">
                  {publicSettings.map(([label, value]) => (
                    <div key={label} className="grid gap-0.5">
                      <dt className="text-muted">{label}</dt>
                      <dd className="break-all">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              <ButtonLink
                className="w-fit"
                href={documentationTopics.logDrains.href}
                rel="noopener noreferrer"
                target="_blank"
                variant="secondary"
              >
                Open documentation
                <NewTabIndicator />
              </ButtonLink>
            </div>
            {unhealthy.map((item) => (
              <div
                key={item.serverId}
                role="status"
                className={`text-sm ${item.status === "auth_failure" ? "text-danger" : "text-warning"}`}
              >
                <p>
                  {item.serverName}: {healthMessage(item.status)}
                </p>
                {item.retryAt ? (
                  <RelativeTime label="Next retry" value={item.retryAt} />
                ) : null}
              </div>
            ))}
          </div>
        </FormCard>
        <FormCard title="Delivery activity" help={false}>
          <div className="grid gap-4">
            <p className="text-xs text-muted">
              Gateway batch counts from the latest check of {health.length}{" "}
              server
              {health.length === 1 ? "" : "s"} for the current configuration. A
              batch can contain many log events.
            </p>
            {health.length ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted">Accepted batches</p>
                    <p className="text-lg tabular-nums">
                      {accepted.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted">Dropped batches</p>
                    <p className="text-lg tabular-nums">
                      {dropped.toLocaleString()}
                    </p>
                  </div>
                </div>
                <div
                  aria-label={`${accepted} accepted batches and ${dropped} dropped batches`}
                  className="flex h-2 overflow-hidden rounded-full bg-default"
                >
                  {total > 0 ? (
                    <>
                      <div
                        className="bg-success"
                        style={{ width: `${(accepted / total) * 100}%` }}
                      />
                      <div
                        className="bg-danger"
                        style={{ width: `${(dropped / total) * 100}%` }}
                      />
                    </>
                  ) : null}
                </div>
                <div className="grid gap-2 text-xs text-muted">
                  {health.map((item) => (
                    <div
                      key={item.serverId}
                      className="flex flex-wrap justify-between gap-x-3 gap-y-1"
                    >
                      <span>{item.serverName}</span>
                      <span className="tabular-nums">
                        {item.acceptedBatches} accepted · {item.droppedBatches}{" "}
                        dropped
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                No server delivery data yet. Deploy a workload using this
                provider, then check again.
              </p>
            )}
          </div>
        </FormCard>
      </div>
    </>
  );
}

function healthMessage(status: LogDrainHealth["status"]) {
  if (status === "auth_failure")
    return "Authentication failed. Forwarding is paused until the runtime credentials are corrected.";
  if (status === "rate_limited")
    return "Three rate limits were received. Forwarding is paused for at least 24 hours.";
  return "The destination is temporarily unavailable. Forwarding will retry with backoff.";
}
