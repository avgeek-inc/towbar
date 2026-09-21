"use client";

import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";

import { useApiQuery } from "@/hooks/use-api-query";
import { NotificationProviderIcon } from "./notification-provider-icon";
import { FormCard } from "./page-parts";

type Provider = "discord" | "slack" | "smtp" | "telegram" | "webhook";
type ProviderState = { providers: Record<Provider, boolean> };
type Route = {
  categories: string[];
  enabled: boolean;
  id: string;
  provider: Provider;
  source: "environment";
};
type DestinationState = { destinations: Route[] };

export function NotificationIntegration({ provider }: { provider: Provider }) {
  const providers = useApiQuery<ProviderState>(
    "/v1/core/notifications/providers",
    30_000,
  );
  const routes = useApiQuery<DestinationState>(
    "/v1/core/notifications/destinations",
    30_000,
  );
  if (providers.error || routes.error)
    return <QueryError message={providers.error ?? routes.error!} />;
  if (!providers.data || !routes.data) return <QueryLoading />;
  if (!providers.data.providers[provider])
    return (
      <QueryError message="This notification provider is not enabled for this Towbar instance." />
    );

  const providerRoutes = routes.data.destinations.filter(
    (route) => route.provider === provider,
  );
  return (
    <div className="content-grid lg:grid-cols-2 lg:items-start">
      <FormCard
        title="Runtime configuration"
        icon={<NotificationProviderIcon provider={provider} />}
        headerEnd={<StatusBadge status="configured" label="Configured" />}
      >
        <div className="grid gap-3">
          <p className="text-sm text-muted">
            This provider and its notification routes are configured by the
            Towbar runtime environment. Values and secrets are never exposed in
            the application.
          </p>
          <p className="text-sm">
            {providerRoutes.length === 1
              ? "1 route configured"
              : `${providerRoutes.length} routes configured`}
          </p>
          {providerRoutes.length ? (
            <ul className="grid gap-2 text-sm text-muted">
              {providerRoutes.map((route) => (
                <li key={route.id}>
                  <span className="text-foreground">{route.id}</span>
                  {route.categories.length
                    ? ` · ${route.categories.join(", ")}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </FormCard>
    </div>
  );
}
