"use client";

import { useState } from "react";
import type { Key, ReactNode } from "react";

import { Label } from "@workspace/web-design-system/forms/label";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import { cn } from "@workspace/web-design-system/lib/utils";
import { Tabs } from "@workspace/web-design-system/navigation/tabs";

import { useResponsiveTabsOrientation } from "@/hooks/use-responsive-tabs-orientation";

type ResponsiveSubtab = {
  content: ReactNode;
  disabledReason?: string;
  isDisabled?: boolean;
  icon?: ReactNode;
  label: string;
  value: string;
};

export function ResponsiveSubtabs({
  ariaLabel,
  collapseOnMobile = true,
  defaultSelectedKey,
  layout = "sidebar",
  onSelectionChange,
  panelClassName,
  selectedKey,
  sidebarWidth = "default",
  tabs,
}: {
  ariaLabel: string;
  collapseOnMobile?: boolean;
  defaultSelectedKey: string;
  layout?: "inline" | "sidebar";
  onSelectionChange?: (key: Key) => void;
  panelClassName?: string;
  selectedKey?: string;
  sidebarWidth?: "default" | "wide";
  tabs: ResponsiveSubtab[];
}) {
  const responsiveOrientation = useResponsiveTabsOrientation();
  const orientation =
    layout === "sidebar" ? responsiveOrientation : "horizontal";
  const [internalSelectedKey, setInternalSelectedKey] =
    useState(defaultSelectedKey);
  const activeKey = selectedKey ?? internalSelectedKey;
  const activeTab = tabs.find((tab) => tab.value === activeKey);

  function selectTab(key: Key | null) {
    if (key === null) return;
    if (selectedKey === undefined) setInternalSelectedKey(String(key));
    onSelectionChange?.(key);
  }

  return (
    <Tabs
      className="block min-w-0"
      orientation={orientation}
      selectedKey={activeKey}
      onSelectionChange={selectTab}
    >
      <div
        className={cn(
          "grid min-w-0 grid-cols-1 items-start gap-4",
          layout === "sidebar"
            ? sidebarWidth === "wide"
              ? "lg:grid-cols-[14rem_minmax(0,1fr)]"
              : "lg:grid-cols-[13rem_minmax(0,1fr)]"
            : "md:gap-0",
        )}
      >
        {collapseOnMobile ? (
          <Select
            fullWidth
            className="md:hidden"
            selectedKey={activeKey}
            variant="secondary"
            onSelectionChange={selectTab}
          >
            <Label className="sr-only">{ariaLabel}</Label>
            <Select.Trigger>
              <Select.Value>
                <span className="inline-flex min-w-0 items-center gap-2">
                  {activeTab?.icon ? (
                    <span
                      aria-hidden="true"
                      className="inline-flex shrink-0 [&_svg]:size-4"
                    >
                      {activeTab.icon}
                    </span>
                  ) : null}
                  <span className="truncate">{activeTab?.label}</span>
                </span>
              </Select.Value>
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {tabs.map((tab) => (
                  <ListBox.Item
                    id={tab.value}
                    isDisabled={tab.isDisabled}
                    key={tab.value}
                    textValue={tab.label}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      {tab.icon ? (
                        <span
                          aria-hidden="true"
                          className="inline-flex shrink-0 [&_svg]:size-4"
                        >
                          {tab.icon}
                        </span>
                      ) : null}
                      {tab.label}
                    </span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
        ) : null}
        <Tabs.ListContainer
          className={cn(
            layout === "sidebar"
              ? "h-fit w-full self-start"
              : "w-fit max-w-full overflow-x-auto",
            collapseOnMobile && "hidden md:block",
          )}
        >
          <Tabs.List
            aria-label={ariaLabel}
            className={layout === "sidebar" ? "w-full" : "min-w-max"}
          >
            {tabs.map((tab) => (
              <Tabs.Tab
                aria-label={
                  tab.isDisabled && tab.disabledReason
                    ? `${tab.label}. ${tab.disabledReason}`
                    : undefined
                }
                className={
                  orientation === "vertical" ? "justify-start" : undefined
                }
                id={tab.value}
                isDisabled={tab.isDisabled}
                key={tab.value}
              >
                <span
                  className={cn(
                    "relative z-10 inline-flex min-w-0 items-center gap-2",
                    layout === "inline" && "whitespace-nowrap",
                  )}
                  title={tab.isDisabled ? tab.disabledReason : undefined}
                >
                  {tab.icon ? (
                    <span
                      aria-hidden="true"
                      className="inline-flex shrink-0 [&_svg]:size-4"
                    >
                      {tab.icon}
                    </span>
                  ) : null}
                  {tab.label}
                </span>
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        <div className="min-w-0">
          {tabs.map((tab) => (
            <Tabs.Panel
              className={cn("m-0 block p-0", panelClassName)}
              id={tab.value}
              key={tab.value}
            >
              {tab.content}
            </Tabs.Panel>
          ))}
        </div>
      </div>
    </Tabs>
  );
}
