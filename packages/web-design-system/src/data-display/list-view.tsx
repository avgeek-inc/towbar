"use client";
import type { ComponentProps, Key, ReactNode } from "react";
import { cn } from "../lib/utils";
type RootProps<T extends { id: Key }> = Omit<
  ComponentProps<"div">,
  "children"
> & {
  children: (item: T) => ReactNode;
  items: T[];
  renderEmptyState?: () => ReactNode;
  selectionMode?: string;
  variant?: string;
  virtualized?: boolean;
};
function Root<T extends { id: Key }>({
  children,
  className,
  items,
  renderEmptyState,
  selectionMode: _selectionMode,
  variant: _variant,
  virtualized: _virtualized,
  ...props
}: RootProps<T>) {
  return (
    <div
      className={cn(
        "grid overflow-hidden rounded-3xl border border-separator bg-surface",
        className,
      )}
      {...props}
    >
      {items.length ? items.map(children) : renderEmptyState?.()}
    </div>
  );
}
function Item({
  className,
  href,
  ...props
}: ComponentProps<"a"> & { id?: Key; textValue?: string }) {
  return (
    <a
      className={cn(
        "flex min-w-0 items-center gap-4 border-b border-separator px-5 py-4 transition-colors last:border-0 hover:bg-default/50",
        className,
      )}
      href={href}
      {...props}
    />
  );
}
function ItemContent({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex min-w-0 flex-1 items-center gap-3", className)}
      {...props}
    />
  );
}
function ItemAction({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("shrink-0", className)} {...props} />;
}
function Title({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("font-medium", className)} {...props} />;
}
function Description({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("text-sm text-muted", className)} {...props} />;
}
export const ListView = Object.assign(Root, {
  Description,
  Item,
  ItemAction,
  ItemContent,
  Root,
  Title,
});
