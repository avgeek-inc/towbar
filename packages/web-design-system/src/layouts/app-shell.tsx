"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
} from "react";
import { Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { usePathname } from "next/navigation";
import { Button } from "../buttons/button";
import { AlertDialog } from "../overlays/alert-dialog";
import { Toast } from "../overlays/toast";
import { ThemeSwitcher } from "../controls/theme-switcher";
import { cn } from "../lib/utils";
import { BrandLockup } from "../media/brand-lockup";
import { useAppNavigate } from "../navigation/app-layout";
import { BreadcrumbTrail } from "../navigation/breadcrumbs";
import { AppShellBoundary, useAppShellHeaderState } from "./app-shell-boundary";
import type {
  ApplicationPolicy,
  ContentWidth,
  FooterConfig,
  HeaderConfig,
  SidebarConfig,
  SidebarActionConfig,
  ShellLinkConfig,
} from "./application-shell-types";

const widths: Record<ContentWidth, string> = {
  small: "max-w-3xl",
  compact: "max-w-5xl",
  relaxed: "max-w-6xl",
  broad: "max-w-7xl",
  full: "max-w-none",
};
const ContentWidthContext = createContext<ContentWidth>("relaxed");
function Root({
  children,
  contentWidth = "relaxed",
  policy,
  className,
  ...props
}: ComponentProps<"div"> & {
  contentWidth?: ContentWidth;
  policy: ApplicationPolicy;
}) {
  return (
    <ContentWidthContext.Provider value={contentWidth}>
      <AppShellBoundary>
        <div className={cn("min-h-dvh", className)} {...props}>
          {children}
          {policy.toasts ? <Toast.Provider /> : null}
        </div>
      </AppShellBoundary>
    </ContentWidthContext.Provider>
  );
}
function Content({
  className,
  variant,
  ...props
}: ComponentProps<"div"> & { variant?: ContentWidth }) {
  const contentWidth = useContext(ContentWidthContext);
  return (
    <div
      className={cn(
        "mx-auto min-h-full w-full min-w-0 px-4 py-3 sm:px-6 sm:py-6 lg:px-8",
        widths[variant ?? contentWidth],
        className,
      )}
      {...props}
    />
  );
}
export const AppShell = Object.assign(Root, { Content, Root });

function RoutedLink({
  item,
  className,
  children,
}: {
  item: ShellLinkConfig;
  className?: string;
  children?: ReactNode;
}) {
  const navigate = useAppNavigate();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!item.external && navigate) {
      event.preventDefault();
      navigate(item.href);
    }
  };
  return (
    <a
      aria-label={item.accessibleLabel}
      className={className}
      href={item.href}
      onClick={onClick}
      rel={item.external ? "noreferrer" : undefined}
      target={item.external ? "_blank" : undefined}
    >
      {children ?? item.label}
    </a>
  );
}
export function ApplicationNavbar({
  actions,
  config,
  hasSidebar = false,
  onSidebarToggle,
  showThemeSwitcher = false,
}: {
  actions?: ReactNode;
  config: HeaderConfig;
  hasSidebar?: boolean;
  onSidebarToggle?: () => void;
  showThemeSwitcher?: boolean;
}) {
  const { breadcrumbItems } = useAppShellHeaderState();
  const homeItem: ShellLinkConfig = {
    id: "home",
    kind: "link",
    href: config.homeHref,
    label: config.brand.title,
  };

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-5 border-b border-separator bg-background/90 px-4 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {hasSidebar ? (
          <Button
            aria-label="Toggle navigation"
            className="size-10 min-h-10 min-w-10 shrink-0"
            isIconOnly
            onPress={onSidebarToggle}
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden="true" icon={Menu01Icon} size={20} />
          </Button>
        ) : (
          <RoutedLink
            className="inline-flex min-w-0 items-center"
            item={homeItem}
          >
            <BrandLockup
              logo={
                config.brand.logo ??
                (config.brand.logoSrc ? (
                  <img alt="" className="size-8" src={config.brand.logoSrc} />
                ) : null)
              }
            >
              {config.brand.title}
            </BrandLockup>
          </RoutedLink>
        )}
        {hasSidebar && breadcrumbItems ? (
          <BreadcrumbTrail items={breadcrumbItems} />
        ) : null}
      </div>
      <nav
        aria-label="Primary navigation"
        className="flex shrink-0 items-center gap-5 text-sm"
      >
        {config.navigation?.map((item) => (
          <RoutedLink
            className="text-muted hover:text-foreground"
            item={item}
            key={item.id}
          />
        ))}
        {config.callToAction ? (
          <RoutedLink
            className="rounded-full bg-accent px-4 py-2 font-medium text-accent-foreground"
            item={config.callToAction}
          />
        ) : null}
        {actions}
        {showThemeSwitcher ? <ThemeSwitcher size="small" /> : null}
      </nav>
    </header>
  );
}
export function ApplicationSidebar({ config }: { config: SidebarConfig }) {
  const pathname = usePathname();
  const homeItem: ShellLinkConfig = {
    id: "home",
    kind: "link",
    href: config.homeHref,
    label: config.brand.title,
  };
  return (
    <nav
      aria-label={config.accessibleLabel}
      className="flex min-h-dvh flex-col"
    >
      <RoutedLink
        className="inline-flex min-h-16 min-w-0 items-center border-b border-separator px-4"
        item={homeItem}
      >
        <BrandLockup
          logo={
            config.brand.logo ??
            (config.brand.logoSrc ? (
              <img alt="" className="size-8" src={config.brand.logoSrc} />
            ) : null)
          }
        >
          {config.brand.title}
        </BrandLockup>
      </RoutedLink>
      <div className="grid flex-1 content-start gap-1 overflow-y-auto px-3 pt-2">
        {config.groups.map((group) => (
          <section className="grid gap-1 [&+&]:mt-2" key={group.id}>
            {group.label ? (
              <h2 className="px-2 py-1.5 text-xs font-medium text-muted">
                {group.label}
              </h2>
            ) : null}
            <div className="grid gap-0.5">
              {group.items.map((item) =>
                item.kind === "link" ? (
                  <RoutedLink
                    className={cn(
                      "flex min-h-9 items-center gap-3 rounded-2xl px-2 py-1.5 text-sm",
                      pathname === item.href ||
                        (item.href !== "/" && pathname.startsWith(item.href))
                        ? "bg-default font-medium text-foreground"
                        : "font-normal text-muted hover:bg-default/60 hover:text-foreground",
                    )}
                    item={item}
                    key={item.id}
                  >
                    {item.icon ? (
                      <HugeiconsIcon icon={item.icon} size={16} />
                    ) : null}
                    {item.label}
                  </RoutedLink>
                ) : (
                  <SidebarAction item={item} key={item.id} />
                ),
              )}
            </div>
          </section>
        ))}
      </div>
      {config.footerActions?.length ? (
        <div className="mt-auto grid gap-1 px-3 pb-4 pt-2">
          {config.footerActions.map((item) => (
            <SidebarAction item={item} key={item.id} />
          ))}
        </div>
      ) : null}
    </nav>
  );
}

function SidebarAction({ item }: { item: SidebarActionConfig }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const trigger = (
    <button
      aria-label={item.accessibleLabel}
      className={cn(
        "flex min-h-9 items-center gap-3 rounded-2xl px-2 py-1.5 text-start text-sm font-normal text-muted hover:bg-default/60 hover:text-foreground disabled:opacity-50",
        item.destructive && "hover:text-danger",
      )}
      disabled={item.disabled}
      onClick={() => {
        if (item.confirmation) setIsConfirming(true);
        else item.onSelect();
      }}
      type="button"
    >
      {item.icon ? (
        <HugeiconsIcon aria-hidden="true" icon={item.icon} size={16} />
      ) : null}
      {item.label}
    </button>
  );

  if (!item.confirmation) return trigger;

  return (
    <>
      {trigger}
      <AlertDialog.Backdrop
        isOpen={isConfirming}
        onOpenChange={setIsConfirming}
      >
        <AlertDialog.Container>
          <AlertDialog.Dialog>
            <AlertDialog.Header>
              <AlertDialog.Heading>
                {item.confirmation.title}
              </AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>{item.confirmation.description}</AlertDialog.Body>
            <AlertDialog.Footer>
              <Button
                variant="secondary"
                onPress={() => setIsConfirming(false)}
              >
                {item.confirmation.cancelLabel}
              </Button>
              <Button
                variant={item.destructive ? "danger" : "primary"}
                onPress={() => {
                  setIsConfirming(false);
                  item.onSelect();
                }}
              >
                {item.confirmation.confirmLabel}
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  );
}
export function ApplicationFooter({
  config,
}: {
  config: FooterConfig;
  policy?: ApplicationPolicy;
}) {
  const copyright = (config.copyright ?? "© {year} Towbar").replace(
    "{year}",
    String(new Date().getFullYear()),
  );
  return (
    <footer className="border-t border-separator px-6 py-10">
      <div className="mx-auto grid max-w-7xl gap-8 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-2">
          <strong>{config.brand.title}</strong>
          {config.description ? (
            <p className="max-w-md text-sm text-muted">{config.description}</p>
          ) : null}
          <p className="text-xs text-muted">{copyright}</p>
        </div>
        <div className="flex gap-10">
          {config.linkGroups?.map((group) => (
            <div className="grid content-start gap-2 text-sm" key={group.id}>
              <strong>{group.title}</strong>
              {group.links.map((item) => (
                <RoutedLink
                  className="text-muted hover:text-foreground"
                  item={item}
                  key={item.id}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </footer>
  );
}
export function usePersistentAppSidebar(storageKey = "towbar-sidebar") {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useLayoutEffect(() => {
    try {
      const isDesktop = window.matchMedia("(min-width: 64rem)").matches;
      const value = isDesktop ? localStorage.getItem(storageKey) : null;
      setSidebarOpen(isDesktop && value !== "false");
    } catch {
      // Storage can be unavailable in private browsing or hardened browsers.
    }
  }, [storageKey]);
  const onSidebarOpenChange = useCallback(
    (open: boolean) => {
      setSidebarOpen(open);
      try {
        if (window.matchMedia("(min-width: 64rem)").matches) {
          localStorage.setItem(storageKey, String(open));
        }
      } catch {
        // Sidebar state is a convenience; navigation still works without it.
      }
    },
    [storageKey],
  );
  return { onSidebarOpenChange, sidebarOpen };
}
