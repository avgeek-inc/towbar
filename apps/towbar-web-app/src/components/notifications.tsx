"use client";

import { MailSend01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";

import { NotificationProviderIcon } from "./notification-provider-icon";
import { NotificationDeliveries } from "./notification-deliveries";
import { NotificationIntegration } from "@/components/notification-integration";
import { PageSelectionTitle } from "@/components/page-selection-title";
import { SecondaryItems } from "@/components/secondary-sidebar";
import { useApiQuery } from "@/hooks/use-api-query";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";

const providers = [
  { id: "slack", label: "Slack", provider: "slack" as const },
  { id: "email", label: "Email", provider: "smtp" as const },
  { id: "discord", label: "Discord", provider: "discord" as const },
  { id: "telegram", label: "Telegram", provider: "telegram" as const },
  { id: "webhook", label: "Webhook push", provider: "webhook" as const },
];

export function Notifications({ notification }: { notification: string }) {
  const router = useRouter();
  const query = useApiQuery<{
    providers: Record<
      "discord" | "slack" | "smtp" | "telegram" | "webhook",
      boolean
    >;
  }>("/v1/core/notifications/providers", 30_000);
  const destinations = useApiQuery<{
    destinations: Array<{ provider: (typeof providers)[number]["provider"] }>;
  }>("/v1/core/notifications/destinations", 30_000);
  const enabledProviders = providers.filter(
    (item) => query.data?.providers[item.provider],
  );
  const active = enabledProviders.find((item) => item.id === notification);
  const fallbackProviderId = enabledProviders[0]?.id;

  useEffect(() => {
    if (
      query.error ||
      destinations.error ||
      !query.data ||
      notification === "deliveries" ||
      active ||
      !fallbackProviderId
    )
      return;
    router.replace(`/manage/integrations/${fallbackProviderId}`);
  }, [
    active,
    destinations.error,
    fallbackProviderId,
    notification,
    query.data,
    query.error,
    router,
  ]);

  if (query.error || destinations.error)
    return <QueryError message={query.error ?? destinations.error!} />;
  if (!query.data || !destinations.data) return <QueryLoading />;
  if (enabledProviders.length === 0)
    return (
      <EmptyState>
        <EmptyState.Header>
          <EmptyState.Title>
            No notification providers configured
          </EmptyState.Title>
          <EmptyState.Description className="max-w-md text-pretty">
            Enable a notification provider in the Towbar runtime environment to
            configure notification routes and review deliveries.
          </EmptyState.Description>
        </EmptyState.Header>
      </EmptyState>
    );
  if (notification !== "deliveries" && !active) return <QueryLoading />;

  return (
    <>
      <PageSelectionTitle
        label={notification === "deliveries" ? "Deliveries" : active!.label}
        icon={
          notification === "deliveries" ? (
            <HugeiconsIcon icon={MailSend01Icon} className="size-6" />
          ) : (
            <NotificationProviderIcon
              provider={active!.provider}
              className="size-6"
            />
          )
        }
      />
      <SecondaryItems
        title="Providers"
        selected={notification}
        onSelect={(value) => router.push(`/manage/integrations/${value}`)}
        items={enabledProviders.map((item) => ({
          id: item.id,
          label: item.label,
          icon: (
            <NotificationProviderIcon
              provider={item.provider}
              className="size-4"
            />
          ),
          badge:
            !query.error &&
            !destinations.error &&
            query.data?.providers[item.provider] ? (
              <span
                role="img"
                aria-label="Configured"
                title="Configured"
                className="block size-1.5 rounded-full bg-success-soft-foreground"
              />
            ) : undefined,
        }))}
      />
      <SecondaryItems
        title="Events"
        selected={notification}
        onSelect={(value) => router.push(`/manage/integrations/${value}`)}
        items={[
          {
            id: "deliveries",
            label: "Deliveries",
            icon: <HugeiconsIcon icon={MailSend01Icon} />,
          },
        ]}
      />
      {notification === "deliveries" ? (
        <NotificationDeliveries />
      ) : (
        <NotificationIntegration provider={active!.provider} />
      )}
    </>
  );
}
