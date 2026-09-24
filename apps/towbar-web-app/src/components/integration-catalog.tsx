import React from "react";
import { MailSend01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { ButtonLink } from "@workspace/web-design-system/buttons/button";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";

import { CloudProviderLogo } from "./cloud-provider-logo";
import { GitHubSettings } from "./github-settings";
import { GitLabSettings } from "./gitlab-settings";
import { IntegrationProviderLogo } from "./integration-provider-logo";
import {
  LogDrainIntegration,
  logDrainNames,
  type LogDrainProvider,
} from "./log-drain-integration";
import { NotificationDeliveries } from "./notification-deliveries";
import { WebhookNotificationIntegration } from "./webhook-notification-integration";
import { EmailNotificationIntegration } from "./email-notification-integration";
import { SlackNotificationIntegration } from "./slack-notification-integration";
import { DiscordNotificationIntegration } from "./discord-notification-integration";
import { TelegramNotificationIntegration } from "./telegram-notification-integration";
import { NotificationProviderIcon } from "./notification-provider-icon";
import { FormCard } from "./page-parts";
import { documentationTopics } from "@/lib/documentation";

export type ProviderItem = {
  value: string;
  provider: string;
  label: string;
  content: React.ReactNode;
  contentOwnsTitle?: boolean;
};

export type ProviderGroup = {
  value: string;
  label: string;
  providers: ProviderItem[];
};

const notificationIconProviders = {
  slack: "slack",
  email: "smtp",
  discord: "discord",
  telegram: "telegram",
  webhook: "webhook",
} as const;

const cloudIconProviders = {
  aws: "aws",
  gcp: "gcp",
  azure: "azure",
  s3: "s3",
  r2: "r2",
  cloudflare: "cloudflare",
} as const;

const brandedIconProviders = {
  github: "github",
  gitlab: "gitlab",
  registry: "registry",
  infisical: "infisical",
  doppler: "doppler",
  "otlp-platform": "otlp",
} as const;

export function getProviderIcon(value: string, className?: string) {
  if (value in notificationIconProviders)
    return (
      <NotificationProviderIcon
        provider={
          notificationIconProviders[
            value as keyof typeof notificationIconProviders
          ]
        }
        className={className}
      />
    );
  if (value === "deliveries")
    return <HugeiconsIcon icon={MailSend01Icon} className={className} />;
  if (value in cloudIconProviders)
    return (
      <CloudProviderLogo
        provider={cloudIconProviders[value as keyof typeof cloudIconProviders]}
        className={className}
      />
    );
  if (value in brandedIconProviders)
    return (
      <IntegrationProviderLogo
        provider={
          brandedIconProviders[value as keyof typeof brandedIconProviders]
        }
        className={className}
      />
    );
  if (Object.hasOwn(logDrainNames, value))
    return (
      <IntegrationProviderLogo
        provider={value as LogDrainProvider}
        className={className}
      />
    );
  return null;
}

const environmentProviders = {
  aws: {
    description:
      "AWS S3 is available to resource backup and restore workflows.",
    documentation: documentationTopics.aws.href,
  },
  azure: {
    description:
      "Azure Blob Storage is available to resource backup and restore workflows.",
    documentation: documentationTopics.azure.href,
  },
  cloudflare: {
    description:
      "Cloudflare is available for tunnel ingress and DNS operations.",
    documentation: documentationTopics.cloudflare.href,
  },
  doppler: {
    description: "Doppler is available for external secret references.",
    documentation: documentationTopics.externalSecrets.href,
  },
  gcp: {
    description:
      "Google Cloud Storage is available to resource backup and restore workflows.",
    documentation: documentationTopics.gcp.href,
  },
  infisical: {
    description: "Infisical is available for external secret references.",
    documentation: documentationTopics.externalSecrets.href,
  },
  "otlp-platform": {
    description: "OpenTelemetry export is enabled for this Towbar instance.",
    documentation: documentationTopics.otlp.href,
  },
  r2: {
    description:
      "Cloudflare R2 is available to resource backup and restore workflows.",
    documentation: documentationTopics.backups.href,
  },
  registry: {
    description:
      "The OCI registry is available for private images and build transfers.",
    documentation: documentationTopics.registry.href,
  },
  s3: {
    description:
      "S3-compatible storage is available to resource backup and restore workflows.",
    documentation: documentationTopics.backups.href,
  },
} as const;

type EnvironmentProviderName = keyof typeof environmentProviders;

function EnvironmentProvider({
  provider,
}: {
  provider: EnvironmentProviderName;
}) {
  const metadata = environmentProviders[provider];
  return (
    <div className="content-grid grid-cols-[repeat(auto-fill,minmax(min(28rem,100%),1fr))] items-start">
      <FormCard title="Runtime configuration" help={false}>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <p className="text-sm text-muted">{metadata.description}</p>
            <p className="text-xs text-muted">
              This integration is configured by the Towbar runtime environment.
              Refer to documentation for more info on the usage of this
              integration.
            </p>
          </div>
          <ButtonLink
            className="w-fit"
            href={metadata.documentation}
            rel="noopener noreferrer"
            target="_blank"
            variant="secondary"
          >
            Open documentation
            <NewTabIndicator />
          </ButtonLink>
        </div>
      </FormCard>
    </div>
  );
}

const environmentProvider = (
  value: EnvironmentProviderName,
  provider: string,
  label: string,
): ProviderItem => ({
  value,
  provider,
  label,
  content: <EnvironmentProvider provider={value} />,
});

export const integrationGroups = [
  {
    value: "source-control",
    label: "Source control",
    providers: [
      {
        value: "github",
        provider: "github",
        label: "GitHub",
        content: <GitHubSettings />,
      },
      {
        value: "gitlab",
        provider: "gitlab",
        label: "GitLab",
        content: <GitLabSettings />,
      },
    ],
  },
  {
    value: "registries",
    label: "Container registries",
    providers: [environmentProvider("registry", "registry", "OCI registry")],
  },
  {
    value: "backup-providers",
    label: "Backup providers",
    providers: [
      environmentProvider("aws", "aws", "AWS S3"),
      environmentProvider("gcp", "gcs", "Google Cloud Storage"),
      environmentProvider("azure", "azureBlob", "Azure Blob Storage"),
      environmentProvider("s3", "s3", "S3 compatible"),
      environmentProvider("r2", "r2", "Cloudflare R2"),
    ],
  },
  {
    value: "secret-providers",
    label: "External secrets",
    providers: [
      environmentProvider("infisical", "infisical", "Infisical"),
      environmentProvider("doppler", "doppler", "Doppler"),
    ],
  },
  {
    value: "platform-providers",
    label: "Platform services",
    providers: [
      environmentProvider("cloudflare", "cloudflare", "Cloudflare"),
      environmentProvider("otlp-platform", "otlp", "OpenTelemetry"),
    ],
  },
] satisfies ProviderGroup[];

export const logForwardingProviders = Object.entries(logDrainNames).map(
  ([value, label]) => ({
    value,
    provider: value,
    label,
    content: <LogDrainIntegration provider={value as LogDrainProvider} />,
  }),
);

export const notificationProviders = [
  {
    value: "slack",
    provider: "slack",
    label: "Slack",
    contentOwnsTitle: true,
    content: <SlackNotificationIntegration />,
  },
  {
    value: "email",
    provider: "smtp",
    label: "Email",
    contentOwnsTitle: true,
    content: <EmailNotificationIntegration />,
  },
  {
    value: "discord",
    provider: "discord",
    label: "Discord",
    contentOwnsTitle: true,
    content: <DiscordNotificationIntegration />,
  },
  {
    value: "telegram",
    provider: "telegram",
    label: "Telegram",
    contentOwnsTitle: true,
    content: <TelegramNotificationIntegration />,
  },
  {
    value: "webhook",
    provider: "webhook",
    label: "Webhook push",
    contentOwnsTitle: true,
    content: <WebhookNotificationIntegration />,
  },
] as const;

export const notificationDeliveries: ProviderItem = {
  value: "deliveries",
  provider: "deliveries",
  label: "Deliveries",
  content: <NotificationDeliveries />,
};
