"use client";

import { useContext, type Key, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@workspace/web-design-system/lib/utils";
import { DetailSettingsContext, SecondaryItems } from "./secondary-sidebar";

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
  defaultSelectedKey,
  onSelectionChange,
  panelClassName,
  selectedKey,
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
  const detailSettings = useContext(DetailSettingsContext);
  const pathname = usePathname();
  const search = useSearchParams();
  const parameter = ariaLabel.endsWith("settings")
    ? "settings"
    : ariaLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const requested = selectedKey ?? search.get(parameter) ?? defaultSelectedKey;
  const active =
    tabs.find((tab) => tab.value === requested && !tab.isDisabled) ??
    tabs.find((tab) => !tab.isDisabled);
  function select(key: string) {
    if (selectedKey === undefined) {
      const params = new URLSearchParams(search.toString());
      params.set(parameter, key);
      if (detailSettings !== null) params.set("section", "settings");
      window.history.pushState(null, "", `${pathname}?${params}`);
    }
    onSelectionChange?.(key);
  }
  return (
    <>
      <SecondaryItems
        title={detailSettings !== null ? "Settings" : ariaLabel}
        selected={detailSettings === false ? "" : (active?.value ?? "")}
        onSelect={select}
        items={tabs.map((tab) => ({
          id: tab.value,
          label: tab.label,
          icon: tab.icon,
          disabled: tab.isDisabled,
          disabledReason: tab.disabledReason,
        }))}
      />
      {detailSettings !== false ? (
        <DetailSettingsContext.Provider value={null}>
          <div className={cn("min-w-0", panelClassName)}>{active?.content}</div>
        </DetailSettingsContext.Provider>
      ) : null}
    </>
  );
}
