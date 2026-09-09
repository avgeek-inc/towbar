"use client";

import {
  CloudIcon,
  GithubIcon,
  Mail01Icon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  AwsCredentialMetadata,
  AzureCredentialMetadata,
  GcpCredentialMetadata,
  GitHubConnection,
} from "@workspace/towbar-web-client";
import { useApiQuery } from "@/hooks/use-api-query";
import { usePageQuery } from "@/hooks/use-page-query";

import { CloudProviderLogo } from "@/components/cloud-provider-logo";
import { PageSelectionTitle } from "./page-selection-title";
import { AwsIntegration } from "@/components/aws-integration";
import { AzureIntegration } from "@/components/azure-integration";
import { GcpIntegration } from "@/components/gcp-integration";
import { GitHubSettings } from "@/components/github-settings";
import { NotificationIntegration } from "@/components/notification-integration";
import { SecondaryItems } from "@/components/secondary-sidebar";

function getProviderIcon(value: string, className?: string) {
  if (value === "aws" || value === "gcp" || value === "azure") {
    return <CloudProviderLogo provider={value} className={className} />;
  }
  const icons: Record<string, typeof GithubIcon> = {
    github: GithubIcon,
    slack: SlackIcon,
    email: Mail01Icon,
  };
  const Icon = icons[value] ?? CloudIcon;
  return <HugeiconsIcon icon={Icon} className={className} />;
}

const integrationGroups = [
  {
    value: "source-control",
    label: "Source control",
    providers: [
      {
        value: "github",
        label: "GitHub",
        content: <GitHubSettings />,
      },
    ],
  },
  {
    value: "backup-providers",
    label: "Backup providers",
    icon: CloudIcon,
    providers: [
      {
        value: "aws",
        label: "AWS",
        content: <AwsIntegration />,
      },
      {
        value: "gcp",
        label: "Google Cloud",
        content: <GcpIntegration />,
      },
      {
        value: "azure",
        label: "Azure",
        content: <AzureIntegration />,
      },
    ],
  },
  {
    value: "notifications",
    label: "Notifications",
    providers: [
      {
        value: "slack",
        label: "Slack",
        content: <NotificationIntegration provider="slack" />,
      },
      {
        value: "email",
        label: "Email",
        content: <NotificationIntegration provider="smtp" />,
      },
    ],
  },
];

export function Integrations() {
  const { search, update } = usePageQuery();
  const github = useApiQuery<{ connection: GitHubConnection | null }>(
    "/v1/core/github",
    30_000,
  );
  const aws = useApiQuery<{ credential: AwsCredentialMetadata | null }>(
    "/v1/core/aws",
    30_000,
  );
  const gcp = useApiQuery<{ credential: GcpCredentialMetadata | null }>(
    "/v1/core/gcp",
    30_000,
  );
  const azure = useApiQuery<{ credential: AzureCredentialMetadata | null }>(
    "/v1/core/azure",
    30_000,
  );
  const notifications = useApiQuery<{
    providers: { slack: boolean; smtp: boolean };
  }>("/v1/core/notifications/providers", 30_000);
  const statuses: Record<string, string | undefined> = {
    github:
      !github.error &&
      github.data?.connection &&
      !github.data.connection.suspendedAt
        ? "Connected"
        : undefined,
    aws:
      !aws.error && aws.data?.credential?.status === "verified"
        ? "Connected"
        : undefined,
    gcp:
      !gcp.error && gcp.data?.credential?.status === "verified"
        ? "Connected"
        : undefined,
    azure:
      !azure.error && azure.data?.credential?.status === "verified"
        ? "Connected"
        : undefined,
    slack:
      !notifications.error && notifications.data?.providers.slack
        ? "Configured"
        : undefined,
    email:
      !notifications.error && notifications.data?.providers.smtp
        ? "Configured"
        : undefined,
  };
  const providers = integrationGroups.flatMap((group) => group.providers);
  const activeProvider =
    providers.find(
      (provider) => provider.value === search.get("integration"),
    ) ?? providers[0]!;

  return (
    <>
      <PageSelectionTitle
        label={activeProvider.label}
        icon={getProviderIcon(activeProvider.value, "size-6")}
      />
      {integrationGroups.map((group) => (
        <SecondaryItems
          key={group.value}
          title={group.label}
          selected={activeProvider.value}
          onSelect={(value) => update({ integration: value })}
          items={group.providers.map((provider) => ({
            id: provider.value,
            label: provider.label,
            icon: getProviderIcon(provider.value, "size-4"),
            badge: statuses[provider.value] ? (
              <span
                role="img"
                aria-label={statuses[provider.value]}
                title={statuses[provider.value]}
                className="block size-1.5 rounded-full bg-success"
              />
            ) : undefined,
          }))}
        />
      ))}
      {activeProvider.content}
    </>
  );
}
