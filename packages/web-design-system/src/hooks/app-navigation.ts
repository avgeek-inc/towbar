"use client";

import { createContext, useContext } from "react";

export const MobileNavigationContext = createContext<{
  host: HTMLElement | null;
  isMobile: boolean;
  close: () => void;
  registerSecondaryNavigation: () => () => void;
}>({
  host: null,
  isMobile: false,
  close: () => {},
  registerSecondaryNavigation: () => () => {},
});

export function useMobileNavigation() {
  return useContext(MobileNavigationContext);
}

export const NavigationContext = createContext<
  ((href: string) => void) | undefined
>(undefined);
export function useAppNavigate() {
  return useContext(NavigationContext);
}
