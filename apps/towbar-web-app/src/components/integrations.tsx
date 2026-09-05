"use client";

import {
  CloudIcon,
  GithubIcon,
  GitBranchIcon,
  Mail01Icon,
  Notification03Icon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Key } from "react";

import { AwsIntegration } from "@/components/aws-integration";
import { GitHubSettings } from "@/components/github-settings";
import { NotificationIntegration } from "@/components/notification-integration";
import { ResponsiveSubtabs } from "@/components/responsive-subtabs";

const integrationGroups = [
  {
    value: "source-control",
    label: "Source control",
    icon: GitBranchIcon,
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
    value: "cloud-providers",
    label: "Cloud providers",
    icon: CloudIcon,
    providers: [
      {
        value: "aws",
        label: "AWS",
        icon: CloudIcon,
        content: <AwsIntegration />,
      },
    ],
  },
  {
    value: "notifications",
    label: "Notifications",
    icon: Notification03Icon,
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
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("integration");
  const activeGroup =
    integrationGroups.find((group) =>
      group.providers.some((provider) => provider.value === requested),
    ) ?? integrationGroups[0]!;
  const activeProvider =
    activeGroup.providers.find((provider) => provider.value === requested) ??
    activeGroup.providers[0]!;

  function selectProvider(key: Key) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("integration", String(key));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <ResponsiveSubtabs
      ariaLabel="Integration categories"
      defaultSelectedKey="source-control"
      selectedKey={activeGroup.value}
      onSelectionChange={(key) => {
        const group = integrationGroups.find((item) => item.value === key);
        if (group) selectProvider(group.providers[0]!.value);
      }}
      tabs={integrationGroups.map((group) => ({
        value: group.value,
        label: group.label,
        icon: <HugeiconsIcon icon={group.icon} />,
        content: (
          <ResponsiveSubtabs
            ariaLabel={`${group.label} integrations`}
            layout="inline"
            collapseOnMobile={false}
            defaultSelectedKey={group.providers[0]!.value}
            selectedKey={
              group === activeGroup
                ? activeProvider.value
                : group.providers[0]!.value
            }
            onSelectionChange={selectProvider}
            tabs={group.providers.map((provider) => ({
              ...provider,
              icon: <HugeiconsIcon icon={provider.icon} />,
            }))}
          />
        ),
      }))}
    />
  );
}
