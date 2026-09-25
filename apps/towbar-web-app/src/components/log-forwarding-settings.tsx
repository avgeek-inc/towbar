"use client";

import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { logDrainStatus } from "@/lib/log-drain-providers";
import {
  logForwardingProviders,
  type ProviderGroup,
} from "./integration-catalog";
import { type LogDrainState } from "./log-drain-integration";
import { ProviderPage } from "./integrations";

export function LogForwardingSettings({ provider }: { provider: string }) {
  const query = useApiQuery<LogDrainState>("/v1/core/log-drains", 30_000);
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;

  const groups: ProviderGroup[] = [
    {
      value: "providers",
      label: "Providers",
      providers: logForwardingProviders,
    },
  ];
  const statuses = Object.fromEntries(
    query.data.configurations.map((item) => [
      item.provider,
      logDrainStatus(item).label,
    ]),
  );
  return (
    <ProviderPage
      groups={groups}
      provider={provider}
      statuses={statuses}
      basePath="/manage/log-forwarding"
    />
  );
}
