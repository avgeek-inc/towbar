"use client";

import { useSyncExternalStore } from "react";

import type { TabsRootProps } from "@workspace/web-design-system/navigation/tabs";

const desktopTabsQuery = "(min-width: 64rem)";

function subscribe(listener: () => void) {
  const mediaQuery = window.matchMedia(desktopTabsQuery);
  mediaQuery.addEventListener("change", listener);
  return () => mediaQuery.removeEventListener("change", listener);
}

function getSnapshot() {
  return window.matchMedia(desktopTabsQuery).matches;
}

function getServerSnapshot() {
  return false;
}

export function useResponsiveTabsOrientation(): NonNullable<
  TabsRootProps["orientation"]
> {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
    ? "vertical"
    : "horizontal";
}
