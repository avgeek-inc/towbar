"use client";

import {
  CloudIcon,
  GithubIcon,
  Mail01Icon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Key } from "react";

import { AwsIntegration } from "@/components/aws-integration";
import { GitHubSettings } from "@/components/github-settings";
import { NotificationIntegration } from "@/components/notification-integration";
import { ResponsiveSubtabs } from "@/components/responsive-subtabs";

const integrationKeys = new Set(["github", "aws", "slack", "email"]);

export function Integrations() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("integration");
  const selectedKey =
    requested && integrationKeys.has(requested) ? requested : "github";

  function selectIntegration(key: Key) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("integration", String(key));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <ResponsiveSubtabs
      ariaLabel="Integrations"
      collapseOnMobile
      defaultSelectedKey="github"
      selectedKey={selectedKey}
      tabs={[
        {
          icon: <HugeiconsIcon icon={GithubIcon} />,
          content: <GitHubSettings />,
          label: "GitHub",
          value: "github",
        },
        {
          icon: <HugeiconsIcon icon={CloudIcon} />,
          content: <AwsIntegration />,
          label: "AWS",
          value: "aws",
        },
        {
          icon: <HugeiconsIcon icon={SlackIcon} />,
          content: <NotificationIntegration provider="slack" />,
          label: "Slack",
          value: "slack",
        },
        {
          icon: <HugeiconsIcon icon={Mail01Icon} />,
          content: <NotificationIntegration provider="smtp" />,
          label: "Email",
          value: "email",
        },
      ]}
      onSelectionChange={selectIntegration}
    />
  );
}
