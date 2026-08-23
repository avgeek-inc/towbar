"use client";

import * as React from "react";
import {
  ComputerIcon,
  Moon02Icon,
  Sun03Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "../lib/utils";
import type { ThemeMode } from "../lib/theme";
import { Tabs } from "../navigation/tabs";
import { useTheme } from "../utilities/providers";

const themeOptions = [
  { icon: ComputerIcon, label: "System", value: "system" },
  { icon: Sun03Icon, label: "Light", value: "light" },
  { icon: Moon02Icon, label: "Dark", value: "dark" },
] satisfies Array<{
  icon: typeof ComputerIcon;
  label: string;
  value: ThemeMode;
}>;

export interface ThemeSwitcherProps extends Omit<
  React.ComponentProps<"div">,
  "children"
> {
  label?: string;
  size?: "default" | "small";
}

export function ThemeSwitcher({
  className,
  label = "Appearance",
  size = "default",
  ...props
}: ThemeSwitcherProps) {
  const { isHydrated, setThemeMode, themeMode } = useTheme();
  return (
    <div
      className={cn("inline-flex w-fit", !isHydrated && "invisible", className)}
      data-slot="theme-switcher"
      {...props}
    >
      <Tabs
        className={cn(
          size === "small" &&
            "[&_[data-slot=tabs-list]]:p-0.5 [&_[data-slot=tabs-tab]]:h-7 [&_[data-slot=tabs-tab]]:px-3",
        )}
        onSelectionChange={(key) => {
          if (key === "system" || key === "light" || key === "dark") {
            setThemeMode(key);
          }
        }}
        selectedKey={themeMode}
      >
        <Tabs.ListContainer>
          <Tabs.List aria-label={label}>
            {themeOptions.map((option) => (
              <Tabs.Tab
                aria-label={`${option.label} theme`}
                id={option.value}
                key={option.value}
              >
                <HugeiconsIcon
                  aria-hidden="true"
                  className="size-4"
                  icon={option.icon}
                />
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
      </Tabs>
    </div>
  );
}
