"use client";

import {
  GithubIcon,
  SecurityCheckIcon,
  UserAccountIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import type { Key, ReactNode } from "react";

import { Tabs } from "@workspace/web-design-system/navigation/tabs";

import { DashboardPage } from "@/components/page-parts";
import { useResponsiveTabsOrientation } from "@/hooks/use-responsive-tabs-orientation";

const settingsNavigation = [
  { icon: UserAccountIcon, label: "Account", value: "account" },
  { icon: GithubIcon, label: "GitHub", value: "github" },
  { icon: SecurityCheckIcon, label: "Security", value: "security" },
] as const;

type SettingsSection = (typeof settingsNavigation)[number]["value"];

export function SettingsPage({
  account,
  github,
  security,
}: Record<SettingsSection, ReactNode>) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const orientation = useResponsiveTabsOrientation();
  const requestedSection = searchParams.get("section");
  const selectedTab =
    settingsNavigation.find((item) => item.value === requestedSection)?.value ??
    "account";
  const panels = { account, github, security } satisfies Record<
    SettingsSection,
    ReactNode
  >;

  useEffect(() => {
    if (requestedSection === selectedTab) return;
    updateSettingsUrl({
      pathname,
      replace: true,
      searchParams,
      section: selectedTab,
    });
  }, [pathname, requestedSection, searchParams, selectedTab]);

  function selectTab(key: Key) {
    const section = String(key) as SettingsSection;
    if (section === selectedTab) return;
    updateSettingsUrl({
      pathname,
      replace: false,
      searchParams,
      section,
    });
  }

  return (
    <DashboardPage title="Settings">
      <Tabs
        className="block"
        orientation={orientation}
        selectedKey={selectedTab}
        onSelectionChange={selectTab}
      >
        <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <Tabs.ListContainer className="w-full">
            <Tabs.List aria-label="Settings sections" className="w-full">
              {settingsNavigation.map((item) => (
                <Tabs.Tab id={item.value} key={item.value}>
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="flex shrink-0 items-center justify-center [&_svg]:size-4"
                    >
                      <HugeiconsIcon icon={item.icon} />
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                  <Tabs.Indicator />
                </Tabs.Tab>
              ))}
            </Tabs.List>
          </Tabs.ListContainer>
          <div className="min-w-0">
            {settingsNavigation.map((item) => (
              <Tabs.Panel
                className="m-0 block p-0"
                id={item.value}
                key={item.value}
              >
                {panels[item.value]}
              </Tabs.Panel>
            ))}
          </div>
        </div>
      </Tabs>
    </DashboardPage>
  );
}

function updateSettingsUrl({
  pathname,
  replace,
  searchParams,
  section,
}: {
  pathname: string;
  replace: boolean;
  searchParams: { toString(): string };
  section: SettingsSection;
}) {
  const params = new URLSearchParams(searchParams.toString());
  params.set("section", section);
  const url = `${pathname}?${params.toString()}`;
  if (replace) window.history.replaceState(null, "", url);
  else window.history.pushState(null, "", url);
}
