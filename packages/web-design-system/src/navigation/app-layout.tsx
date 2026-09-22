"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { cn } from "../lib/utils";
import { Drawer } from "../overlays/drawer";

const desktopQuery = "(min-width: 64rem)";
const subscribeToViewport = (callback: () => void) => {
  const query = window.matchMedia(desktopQuery);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
};
const isDesktopViewport = () => window.matchMedia(desktopQuery).matches;
const serverViewport = () => false;

const MobileNavigationContext = createContext<{
  host: HTMLElement | null;
  isMobile: boolean;
  close: () => void;
}>({ host: null, isMobile: false, close: () => {} });

export function useMobileNavigation() {
  return useContext(MobileNavigationContext);
}

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
  const [mobileHost, setMobileHost] = useState<HTMLElement | null>(null);
  const isDesktop = useSyncExternalStore(
    subscribeToViewport,
    isDesktopViewport,
    serverViewport,
  );

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
      if (event.key === "Escape" && sidebarOpen && isDesktop) {
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
  }, [isDesktop, onSidebarOpenChange, sidebarOpen, toggleShortcut]);

  return (
    <NavigationContext.Provider value={navigate}>
      <MobileNavigationContext.Provider
        value={{
          host: mobileHost,
          isMobile: !isDesktop,
          close: () => {
            if (!isDesktop) onSidebarOpenChange?.(false);
          },
        }}
      >
        <div
          className={cn(
            "min-h-dvh",
            sidebar && sidebarOpen
              ? "lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"
              : "",
            className,
          )}
        >
          {sidebar && sidebarOpen && isDesktop ? (
            <aside
              id="application-navigation"
              className="sticky top-0 h-dvh w-60 overflow-hidden border-r border-separator bg-background"
            >
              {sidebar}
            </aside>
          ) : null}
          <div className="grid min-h-dvh min-w-0 grid-cols-1 grid-rows-[auto_1fr_auto]">
            {navbar}
            <main className="min-w-0">{children}</main>
            {footer}
          </div>
        </div>
        {sidebar ? (
          <Drawer.Backdrop
            isOpen={sidebarOpen && !isDesktop}
            onOpenChange={onSidebarOpenChange}
          >
            <Drawer.Content placement="left">
              <Drawer.Dialog
                id="application-navigation"
                aria-label="Navigation"
                className="group/navigation grid w-72 max-w-[calc(100vw-1rem)] grid-cols-1 overflow-hidden bg-background p-0 has-[[data-secondary-menu]]:w-[min(28rem,calc(100vw-1rem))] has-[[data-secondary-menu]]:grid-cols-[calc(50%-0.75rem)_calc(50%+0.75rem)] sm:w-72"
              >
                <div
                  className="relative min-h-0 min-w-0"
                  data-slot="drawer-body"
                >
                  {sidebar}
                  <Drawer.CloseTrigger
                    aria-label="Close navigation"
                    className="end-3 top-2.5 size-11 bg-transparent hover:bg-transparent data-[hovered=true]:bg-transparent group-has-[[data-secondary-menu]]/navigation:hidden"
                  />
                </div>
                <div
                  className="hidden min-h-0 min-w-0 flex-col border-s border-separator has-[[data-secondary-menu]]:flex"
                  data-slot="drawer-body"
                >
                  <div className="flex min-h-16 shrink-0 items-center justify-end border-b border-separator px-3">
                    <Drawer.CloseTrigger
                      aria-label="Close navigation"
                      className="static size-11 bg-transparent hover:bg-transparent data-[hovered=true]:bg-transparent"
                    />
                  </div>
                  <nav
                    aria-label="Page navigation"
                    ref={setMobileHost}
                    className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto overscroll-contain px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
                  />
                </div>
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        ) : null}
      </MobileNavigationContext.Provider>
    </NavigationContext.Provider>
  );
}
