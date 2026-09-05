"use client";

import {
  CloudIcon,
  GithubIcon,
  Mail01Icon,
  SlackIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import type { Key } from "react";
import {
  Header,
  ListBox,
} from "@workspace/web-design-system/collections/list-box";
import { Label } from "@workspace/web-design-system/forms/label";
import { Select } from "@workspace/web-design-system/forms/select";
import { cn } from "@workspace/web-design-system/lib/utils";

import { AwsIntegration } from "@/components/aws-integration";
import { GitHubSettings } from "@/components/github-settings";
import { NotificationIntegration } from "@/components/notification-integration";

const integrationGroups = [
  {
    label: "Source control",
    items: [{ key: "github", label: "GitHub", icon: GithubIcon }],
  },
  {
    label: "Cloud providers",
    items: [{ key: "aws", label: "AWS", icon: CloudIcon }],
  },
  {
    label: "Notifications",
    items: [
      { key: "slack", label: "Slack", icon: SlackIcon },
      { key: "email", label: "Email", icon: Mail01Icon },
    ],
  },
];
const integrations = integrationGroups.flatMap((group) => group.items);

function IntegrationLabel({ item }: { item: (typeof integrations)[number] }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <HugeiconsIcon
        aria-hidden="true"
        className="size-4 shrink-0"
        icon={item.icon}
      />
      <span className="truncate">{item.label}</span>
    </span>
  );
}

export function Integrations() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get("integration");
  const selected =
    integrations.find((item) => item.key === requested) ?? integrations[0]!;
  const selectedKey = selected.key;

  function integrationHref(key: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("integration", key);
    return `${pathname}?${params.toString()}`;
  }

  function selectIntegration(key: Key | null) {
    if (key !== null)
      router.push(integrationHref(String(key)), { scroll: false });
  }

  return (
    <div className="content-grid min-w-0 items-start md:grid-cols-[13rem_minmax(0,1fr)]">
      <Select
        fullWidth
        className="md:hidden"
        selectedKey={selectedKey}
        variant="secondary"
        onSelectionChange={selectIntegration}
      >
        <Label className="sr-only">Integrations</Label>
        <Select.Trigger>
          <Select.Value>
            <IntegrationLabel item={selected} />
          </Select.Value>
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            {integrationGroups.map((group) => (
              <ListBox.Section key={group.label}>
                <Header>{group.label}</Header>
                {group.items.map((item) => (
                  <ListBox.Item
                    id={item.key}
                    key={item.key}
                    textValue={item.label}
                  >
                    <IntegrationLabel item={item} />
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox.Section>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
      <nav
        aria-label="Integrations"
        className="hidden rounded-2xl bg-surface-secondary p-2 md:grid md:gap-4"
      >
        {integrationGroups.map((group) => (
          <div key={group.label}>
            <h4 className="px-3 pb-1 text-xs font-medium text-muted">
              {group.label}
            </h4>
            <ul className="grid gap-1">
              {group.items.map((item) => (
                <li key={item.key}>
                  <Link
                    href={integrationHref(item.key)}
                    scroll={false}
                    aria-current={selectedKey === item.key ? "page" : undefined}
                    className={cn(
                      "flex min-h-9 items-center rounded-full px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
                      selectedKey === item.key
                        ? "bg-surface text-foreground shadow-sm"
                        : "text-muted hover:bg-surface hover:text-foreground",
                    )}
                  >
                    <IntegrationLabel item={item} />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="min-w-0">
        {selectedKey === "github" ? (
          <GitHubSettings />
        ) : selectedKey === "aws" ? (
          <AwsIntegration />
        ) : (
          <NotificationIntegration
            key={selectedKey}
            provider={selectedKey === "slack" ? "slack" : "smtp"}
          />
        )}
      </div>
    </div>
  );
}
