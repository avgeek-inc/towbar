"use client";

import { Mail01Icon, SlackIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Widget } from "@workspace/web-design-system/data-display/widget";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { InlineLink } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";

export function NotificationIntegration({
  provider,
}: {
  provider: "slack" | "smtp";
}) {
  const query = useApiQuery<{ providers: { slack: boolean; smtp: boolean } }>(
    "/v1/core/notifications/providers",
    30_000,
  );
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;

  const configured = query.data.providers[provider];
  const slack = provider === "slack";
  const name = slack ? "Slack" : "Email";
  return (
    <Widget>
      <Widget.Header
        endContent={
          <Chip size="small" variant={configured ? "success" : "warning"}>
            {configured ? "Configured" : "Not configured"}
          </Chip>
        }
      >
        <Widget.Title
          icon={<HugeiconsIcon icon={slack ? SlackIcon : Mail01Icon} />}
        >
          {name}
        </Widget.Title>
      </Widget.Header>
      <Widget.Content className="content-grid">
        {configured ? (
          <p className="text-sm text-muted">
            {name} is configured through deployment environment variables. Add
            notification destinations under Source → Settings → Notifications.
          </p>
        ) : slack ? (
          <p className="text-sm text-muted">
            Configure the Slack bot token using the{" "}
            <TypographyCode>TOWBAR_SLACK_BOT_TOKEN</TypographyCode> environment
            variable on the Towbar API deployment, then restart the API.
          </p>
        ) : (
          <div className="content-grid text-sm text-muted">
            <p>
              Configure email using the{" "}
              <TypographyCode>TOWBAR_SMTP_HOST</TypographyCode> and{" "}
              <TypographyCode>TOWBAR_SMTP_FROM</TypographyCode> environment
              variables on the Towbar API deployment.
            </p>
            <p>
              If your SMTP server requires authentication, also set{" "}
              <TypographyCode>TOWBAR_SMTP_USERNAME</TypographyCode> and{" "}
              <TypographyCode>TOWBAR_SMTP_PASSWORD</TypographyCode>. Restart the
              API after updating the variables.
            </p>
          </div>
        )}
        <InlineLink
          className="w-fit text-sm"
          href={`https://www.towbar.dev/docs/configuration#${slack ? "slack" : "email-smtp"}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {name} setup documentation
        </InlineLink>
      </Widget.Content>
    </Widget>
  );
}
