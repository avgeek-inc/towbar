"use client";

import type { LogDrainHealth } from "@workspace/towbar-core";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";

import { useApiQuery } from "@/hooks/use-api-query";
import { documentationTopics } from "@/lib/documentation";
import { logDrainNames, logDrainStatus } from "@/lib/log-drain-providers";
import { RelativeTime } from "./last-synced-time";
import { FormCard } from "./page-parts";

export { logDrainNames } from "@/lib/log-drain-providers";

export type LogDrainProvider = keyof typeof logDrainNames;

export type LogDrainConfiguration = {
  provider: LogDrainProvider;
  revision: string;
  source: "environment";
  state: "enabled";
  health?: (LogDrainHealth & { serverId: string; serverName: string })[];
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
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;

  const configuration = query.data.configurations.find(
    (item) => item.provider === provider,
  );
  if (!configuration)
    return (
      <QueryError message="This log forwarding provider is not enabled for this Towbar instance." />
    );

  const unhealthy = (configuration.health ?? []).filter(
    (item) => item.status !== "configured",
  );

  return (
    <div className="content-grid grid-cols-[repeat(auto-fill,minmax(min(28rem,100%),1fr))] items-start">
      <FormCard
        title="Runtime configuration"
        help={false}
        headerEnd={<StatusBadge {...logDrainStatus(configuration)} />}
      >
        <div className="grid gap-4">
          <div className="grid gap-3">
            <p className="text-sm text-muted">
              This destination is configured by the Towbar runtime environment.
              Refer to documentation for more info on the usage of this
              integration.
            </p>
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
    </div>
  );
}

function healthMessage(status: LogDrainHealth["status"]) {
  if (status === "auth_failure")
    return "Authentication failed. Forwarding is paused until the runtime credentials are corrected.";
  if (status === "rate_limited")
    return "Three rate limits were received. Forwarding is paused for at least 24 hours.";
  return "The destination is temporarily unavailable. Forwarding will retry with backoff.";
}
