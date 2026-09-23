"use client";

import type { NotificationCategory } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";

import { useApiQuery } from "@/hooks/use-api-query";
import { documentationTopics } from "@/lib/documentation";
import { FormCard } from "./page-parts";

type Provider = "discord" | "slack" | "smtp" | "telegram" | "webhook";
type ProviderState = { providers: Record<Provider, boolean> };
type Route = {
  categories: NotificationCategory[];
  enabled: boolean;
  id: string;
  provider: Provider;
  source: "environment";
};
type DestinationState = { destinations: Route[] };

const providerDetails = {
  discord: {
    description:
      "Towbar sends operational updates to Discord. Webhook URLs are managed in the runtime configuration.",
    guide: documentationTopics.discord.href,
  },
  slack: {
    description:
      "Towbar sends operational updates to Slack. Channels and bot credentials are managed in the runtime configuration.",
    guide: documentationTopics.slack.href,
  },
  smtp: {
    description:
      "Towbar sends operational updates by email through this instance’s SMTP connection. Recipients and credentials are managed in the runtime configuration.",
    guide: documentationTopics.email.href,
  },
  telegram: {
    description:
      "Towbar sends operational updates to Telegram. Chats and bot credentials are managed in the runtime configuration.",
    guide: documentationTopics.telegram.href,
  },
  webhook: {
    description:
      "Towbar posts operational events to HTTPS endpoints. Endpoint URLs are managed in the runtime configuration.",
    guide: documentationTopics.webhook.href,
  },
} satisfies Record<Provider, { description: string; guide: string }>;

const categoryLabels: Record<NotificationCategory, string> = {
  backups: "Backups",
  deployments: "Deployments",
  health: "Service health",
  previews: "Preview environments",
  restores: "Restores",
  scout: "Scout alerts",
};

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
    (route) => route.provider === provider && route.enabled,
  );
  return (
    <div className="content-grid grid-cols-[repeat(auto-fill,minmax(min(28rem,100%),1fr))] items-start">
      <FormCard title="Notification routing" help={false}>
        <div className="grid gap-5">
          <p className="text-sm text-muted">
            {providerDetails[provider].description}
          </p>
          {providerRoutes.length ? (
            <ul className="divide-y divide-separator border-t border-separator">
              {providerRoutes.map((route) => (
                <li key={route.id} className="py-4 last:pb-0">
                  <dl className="grid gap-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(0,2fr)] sm:gap-5">
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">Route ID</dt>
                      <dd className="text-sm font-medium break-all">
                        {route.id}
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-xs text-muted">
                        Sends notifications for
                      </dt>
                      <dd className="text-sm">
                        {route.categories
                          .map((category) => categoryLabels[category])
                          .join(", ")}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-separator pt-4 text-sm text-muted">
              No notification routes use this provider.
            </p>
          )}
          <ButtonLink
            className="w-fit"
            href={providerDetails[provider].guide}
            rel="noopener noreferrer"
            target="_blank"
            variant="secondary"
          >
            Configuration guide
            <NewTabIndicator />
          </ButtonLink>
        </div>
      </FormCard>
    </div>
  );
}
