"use client";

import * as React from "react";
import { Moon02Icon, Sun03Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { cn } from "../lib/utils";
import { useTheme } from "../utilities/providers";

export interface ThemeSwitcherProps extends Omit<
  React.ComponentProps<"button">,
  "children" | "onClick" | "type"
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
  const { isHydrated, resolvedTheme, setThemeMode } = useTheme();
  const nextTheme = resolvedTheme === "dark" ? "light" : "dark";
  const icon = resolvedTheme === "dark" ? Moon02Icon : Sun03Icon;
  const actionLabel = `${label}: switch to ${nextTheme} theme`;

  return (
    <button
      aria-label={actionLabel}
      className={cn(
        "relative isolate grid shrink-0 cursor-pointer touch-manipulation place-items-center rounded-full bg-default text-muted outline-none transition-[color,background-color,transform] hover:bg-default/80 hover:text-foreground active:scale-[0.96] focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-background motion-reduce:transition-none",
        size === "small" ? "size-8" : "size-10",
        !isHydrated && "invisible",
        className,
      )}
      data-slot="theme-switcher"
      title={`Switch to ${nextTheme} theme`}
      type="button"
      onClick={() => setThemeMode(nextTheme)}
      {...props}
    >
      <HugeiconsIcon aria-hidden="true" className="size-4" icon={icon} />
    </button>
  );
}
