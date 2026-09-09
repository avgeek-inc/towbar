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
  GitHubConnection,
} from "@workspace/towbar-web-client";
import { useApiQuery } from "@/hooks/use-api-query";
import { usePageQuery } from "@/hooks/use-page-query";

import { PageSelectionTitle } from "./page-selection-title";
import { AwsIntegration } from "@/components/aws-integration";
import { AzureIntegration } from "@/components/azure-integration";
import { GcpIntegration } from "@/components/gcp-integration";
import { GitHubSettings } from "@/components/github-settings";
import { NotificationIntegration } from "@/components/notification-integration";
import { SecondaryItems } from "@/components/secondary-sidebar";

const integrationGroups = [
  {
    value: "source-control",
    label: "Source control",
    providers: [
      {
        value: "github",
        label: "GitHub",
        icon: GithubIcon,
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
        icon: CloudIcon,
        content: <AwsIntegration />,
      },
      {
        value: "gcp",
        label: "Google Cloud",
        icon: CloudIcon,
        content: <GcpIntegration />,
      },
      {
        value: "azure",
        label: "Azure",
        icon: CloudIcon,
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
        icon: SlackIcon,
        content: <NotificationIntegration provider="slack" />,
      },
      {
        value: "email",
        label: "Email",
        icon: Mail01Icon,
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
        icon={<HugeiconsIcon icon={activeProvider.icon} />}
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
            icon: <HugeiconsIcon icon={provider.icon} />,
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
