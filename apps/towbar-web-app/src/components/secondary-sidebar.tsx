"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { HugeiconsIcon } from "@hugeicons/react";
import {
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
} from "@hugeicons/core-free-icons";
import { usePathname } from "next/navigation";
import { cn } from "@workspace/web-design-system/lib/utils";
import { Button } from "@workspace/web-design-system/buttons/button";

const SecondaryContext = createContext<{
  host: HTMLElement | null;
  close: () => void;
}>({ host: null, close: () => {} });

export function SecondarySidebarLayout({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const id = useId();
  return (
    <SecondaryContext.Provider value={{ host, close: () => setOpen(false) }}>
      <div className="min-w-0 lg:grid lg:has-[[data-secondary-menu]]:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden min-w-0 border-b border-separator bg-background has-[[data-secondary-menu]]:block lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:self-start lg:border-b-0 lg:border-r">
          <div className="p-3 lg:hidden">
            <Button
              variant="secondary"
              aria-expanded={open}
              aria-controls={id}
              onPress={() => setOpen(!open)}
            >
              <HugeiconsIcon
                icon={Menu01Icon}
                className="size-4"
                aria-hidden="true"
              />
              Page menu
            </Button>
          </div>
          <div
            id={id}
            className={cn(
              "max-h-[60dvh] overflow-y-auto overscroll-contain px-3 py-2 lg:max-h-full lg:h-full",
              !open && "hidden lg:block",
            )}
          >
            <nav
              aria-label="Page navigation"
              key={pathname}
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
}: {
  title: string;
  children: ReactNode;
}) {
  const { host } = useContext(SecondaryContext);
  const content = (
    <section data-secondary-menu className="grid min-w-0 gap-1">
      <h2 className="px-2 py-1.5 text-xs font-medium text-muted">{title}</h2>
      {children}
    </section>
  );
  return host ? createPortal(content, host) : null;
}

export type SecondaryItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
};
const menuIcons: Record<string, typeof Menu01Icon> = {
  keys: Key01Icon,
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
                ? "bg-default font-medium text-foreground"
                : "font-normal text-muted hover:bg-default/60 hover:text-foreground",
            )}
          >
            {!item.disabled ? (
              <span
                aria-hidden="true"
                className="inline-flex shrink-0 [&_svg]:size-4"
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
              <span className="shrink-0 text-xs tabular-nums">
                {item.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </SecondarySection>
  );
}
