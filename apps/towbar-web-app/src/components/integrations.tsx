"use client";

import { useEffect } from "react";
import type { IntegrationProvider } from "@workspace/towbar-core";
import { usePathname } from "next/navigation";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";

import { useApiQuery } from "@/hooks/use-api-query";
import { PageSelectionTitle } from "./page-selection-title";
import { SecondaryItems } from "./secondary-sidebar";
import {
  getProviderIcon,
  integrationGroups,
  type ProviderGroup,
} from "./integration-catalog";

export function ProviderPage({
  groups,
  provider,
  statuses,
  basePath,
}: {
  groups: ProviderGroup[];
  provider: string;
  statuses: Record<string, string | undefined>;
  basePath: string;
}) {
  const pathname = usePathname();
  const selectedProvider = pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length + 1)
    : provider;
  const providers = groups.flatMap((group) => group.providers);
  const activeProvider = providers.find(
    (item) => item.value === selectedProvider,
  );
  const fallbackProvider = providers[0]?.value;

  useEffect(() => {
    if (!activeProvider && fallbackProvider)
      window.history.replaceState(null, "", `${basePath}/${fallbackProvider}`);
  }, [activeProvider, basePath, fallbackProvider]);

  if (!fallbackProvider)
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>No integrations configured</EmptyState.Title>
          <EmptyState.Description className="max-w-md text-pretty">
            Configure an integration in the Towbar runtime environment to make
            it available here.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  if (!activeProvider) return <QueryLoading />;

  return (
    <>
      {activeProvider.contentOwnsTitle ? null : (
        <PageSelectionTitle
          label={activeProvider.label}
          icon={getProviderIcon(activeProvider.value, "size-6")}
        />
      )}
      {groups.map((group) => (
        <SecondaryItems
          key={group.value}
          title={group.label}
          selected={activeProvider.value}
          onSelect={(value) => {
            if (value === activeProvider.value) return;
            window.history.pushState(null, "", `${basePath}/${value}`);
            window.scrollTo(0, 0);
          }}
          items={group.providers.map((item) => ({
            id: item.value,
            label: item.label,
            icon: getProviderIcon(item.value, "size-4"),
            badge: statuses[item.value] ? (
              <span
                role="img"
                aria-label={statuses[item.value]}
                title={statuses[item.value]}
                className="block size-1.5 rounded-full bg-success-soft-foreground"
              />
            ) : undefined,
          }))}
        />
      ))}
      {activeProvider.content}
    </>
  );
}

type IntegrationCapabilities = {
  integrations: Array<{ category: string; provider: IntegrationProvider }>;
};

export function Integrations({ integration }: { integration: string }) {
  const integrations = useApiQuery<IntegrationCapabilities>(
    "/v1/core/integrations",
    30_000,
  );
  if (integrations.error) return <QueryError message={integrations.error} />;
  if (!integrations.data) return <QueryLoading />;

  const enabled = new Set(
    integrations.data.integrations.map((item) => item.provider),
  );
  const groups: ProviderGroup[] = integrationGroups
    .map((group) => ({
      ...group,
      providers: group.providers.filter((item) =>
        enabled.has(item.provider as IntegrationProvider),
      ),
    }))
    .filter((group) => group.providers.length > 0);
  const statuses: Record<string, string> = Object.fromEntries(
    groups
      .flatMap((group) => group.providers)
      .map((item) => [item.value, "Configured"] as const),
  );
  return (
    <ProviderPage
      groups={groups}
      provider={integration}
      statuses={statuses}
      basePath="/manage/integrations"
    />
  );
}

export {
  getProviderIcon,
  integrationGroups,
  logForwardingProviders,
  notificationProviders,
} from "./integration-catalog";
