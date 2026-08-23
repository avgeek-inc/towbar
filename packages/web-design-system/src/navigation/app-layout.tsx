"use client";

import { createContext, type ReactNode, useContext } from "react";
import { cn } from "../lib/utils";

const NavigationContext = createContext<((href: string) => void) | undefined>(
  undefined,
);
export function useAppNavigate() {
  return useContext(NavigationContext);
}
export function AppLayout({
  children,
  className,
  footer,
  navbar,
  navigate,
  sidebar,
  sidebarOpen = true,
}: {
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
  navbar?: ReactNode;
  navigate?: (href: string) => void;
  onSidebarOpenChange?: (open: boolean) => void;
  scrollMode?: string;
  sidebar?: ReactNode;
  sidebarCollapsible?: string;
  sidebarOpen?: boolean;
  toggleShortcut?: boolean;
}) {
  return (
    <NavigationContext.Provider value={navigate}>
      <div
        className={cn(
          "min-h-dvh",
          sidebar && sidebarOpen
            ? "lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]"
            : "",
          className,
        )}
      >
        {sidebar && sidebarOpen ? (
          <aside className="hidden min-h-dvh border-r border-separator bg-surface lg:block">
            {sidebar}
          </aside>
        ) : null}
        <div className="grid min-h-dvh min-w-0 grid-rows-[auto_1fr_auto]">
          {navbar}
          <main className="min-w-0">{children}</main>
          {footer}
        </div>
      </div>
    </NavigationContext.Provider>
  );
}
