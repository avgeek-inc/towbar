"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
} from "react";
import { usePathname } from "next/navigation";
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
  onSidebarOpenChange,
  sidebar,
  sidebarOpen = true,
  toggleShortcut = false,
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
  const pathname = usePathname();
  const previousPathname = useRef(pathname);

  useEffect(() => {
    const routeChanged = previousPathname.current !== pathname;
    previousPathname.current = pathname;
    if (
      routeChanged &&
      onSidebarOpenChange &&
      !window.matchMedia("(min-width: 64rem)").matches
    ) {
      onSidebarOpenChange(false);
    }
  }, [onSidebarOpenChange, pathname]);

  useEffect(() => {
    if (!sidebarOpen && !toggleShortcut) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && sidebarOpen) {
        onSidebarOpenChange?.(false);
        return;
      }
      if (
        toggleShortcut &&
        event.key.toLowerCase() === "b" &&
        (event.metaKey || event.ctrlKey)
      ) {
        event.preventDefault();
        onSidebarOpenChange?.(!sidebarOpen);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSidebarOpenChange, sidebarOpen, toggleShortcut]);

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
          <>
            <button
              aria-label="Close navigation"
              className="fixed inset-0 z-40 bg-black/30 lg:hidden"
              onClick={() => onSidebarOpenChange?.(false)}
              type="button"
            />
            <aside className="fixed inset-y-0 start-0 z-50 w-64 overflow-y-auto border-r border-separator bg-surface lg:sticky lg:top-0 lg:z-auto lg:h-dvh">
              {sidebar}
            </aside>
          </>
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
