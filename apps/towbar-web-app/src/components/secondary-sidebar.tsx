"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Activity01Icon,
  Delete02Icon,
  Menu01Icon,
  DashboardCircleIcon,
  Settings01Icon,
  Key01Icon,
  SourceCodeIcon,
  ReloadIcon,
  Rocket01Icon,
  PlugSocketIcon,
  ServerStack01Icon,
  Notification01Icon,
  GitBranchIcon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@workspace/web-design-system/lib/utils";
import { useMobileNavigation } from "@workspace/web-design-system/navigation/app-layout";

export const DetailSettingsContext = createContext<boolean | null>(null);

const SecondaryContext = createContext<{
  host: HTMLElement | null;
  close: () => void;
}>({ host: null, close: () => {} });

export function SecondarySidebarLayout({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const mobileNavigation = useMobileNavigation();
  return (
    <SecondaryContext.Provider
      value={{
        host: mobileNavigation.isMobile ? mobileNavigation.host : host,
        close: mobileNavigation.close,
      }}
    >
      <div className="min-w-0 lg:grid lg:has-[[data-secondary-menu]]:grid-cols-[auto_minmax(0,1fr)]">
        <aside className="hidden min-w-0 border-r border-separator bg-background lg:has-[[data-secondary-menu]]:block lg:w-66 lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:self-start">
          <div className="h-full overflow-y-auto overscroll-contain px-3 py-4 has-[[data-secondary-header]]:py-2">
            <nav
              aria-label="Page navigation"
              className="grid content-start gap-3"
              ref={setHost}
            />
          </div>
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </SecondaryContext.Provider>
  );
}

export function SecondarySection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const { host } = useContext(SecondaryContext);
  const content = (
    <section
      data-secondary-menu
      className={cn("grid min-w-0 gap-1", className)}
    >
      <h2 className="px-2 py-1.5 text-xs font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
  return host ? createPortal(content, host) : null;
}

export function SecondaryEntityHeader({
  children,
  title,
  icon,
}: {
  children: ReactNode;
  title: string;
  icon: ReactNode;
}) {
  const { host } = useContext(SecondaryContext);
  return host
    ? createPortal(
        <div
          data-secondary-menu
          data-secondary-header
          className="order-[-2] flex min-w-0 items-center gap-2 px-2 pb-3 text-sm font-medium text-foreground lg:pt-4 lg:text-xl"
        >
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 [&_svg]:size-4 lg:[&_svg]:size-6"
          >
            {icon}
          </span>
          <TooltipText className="min-w-0 flex-1 truncate" tooltip={title}>
            {children}
          </TooltipText>
        </div>,
        host,
      )
    : null;
}

export type SecondaryItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
};
export const menuIcons: Record<string, typeof Menu01Icon> = {
  credentials: Key01Icon,
  monitoring: Activity01Icon,
  cleanup: Delete02Icon,
  danger: Delete02Icon,
  backups: ReloadIcon,
  backup: ReloadIcon,
  restore: Undo02Icon,
  preview: Rocket01Icon,
  keys: Key01Icon,
  "private-keys": Key01Icon,
  api: SourceCodeIcon,
  mcp: SourceCodeIcon,
  configuration: Settings01Icon,
  connection: PlugSocketIcon,
  "auto-deploy": Rocket01Icon,
  secrets: Key01Icon,
  manifest: SourceCodeIcon,
  "sync-history": ReloadIcon,
  "source-control": GitBranchIcon,
  cloud: ServerStack01Icon,
  notifications: Notification01Icon,
};

export function SecondaryItems({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: SecondaryItem[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  const { close } = useContext(SecondaryContext);
  return (
    <SecondarySection title={title}>
      <div className="grid gap-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={item.disabled}
            aria-current={selected === item.id ? "page" : undefined}
            title={item.disabledReason}
            onClick={() => {
              onSelect(item.id);
              close();
            }}
            className={cn(
              "flex min-h-9 w-full min-w-0 items-center gap-3 rounded-2xl px-2 py-1.5 text-start text-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50",
              selected === item.id
                ? item.destructive
                  ? "bg-danger-soft font-medium text-danger-soft-foreground"
                  : "bg-default font-medium text-foreground"
                : item.destructive
                  ? "font-normal text-danger-soft-foreground hover:bg-danger-soft"
                  : "font-normal text-foreground hover:bg-default/60",
            )}
          >
            {!item.disabled ? (
              <span
                aria-hidden="true"
                className="inline-flex shrink-0 [&_img]:size-4 [&_svg]:size-4"
              >
                {item.icon ?? (
                  <HugeiconsIcon
                    icon={menuIcons[item.id] ?? DashboardCircleIcon}
                  />
                )}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 break-words">{item.label}</span>
            {item.badge ? (
              <span className="shrink-0 text-xs font-mono tabular-nums text-muted">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </SecondarySection>
  );
}
