"use client";

import {
  createContext,
  forwardRef,
  type ComponentPropsWithRef,
  type ReactNode,
  useContext,
} from "react";
import { Widget } from "./widget";
import { cn } from "../lib/utils";

export type AttributesVariant = "card" | "list";
export type AttributesColumns = 1 | 2 | 3;
const VariantContext = createContext<AttributesVariant>("list");
const columns = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
} as const;

export interface AttributesProps extends Omit<
  ComponentPropsWithRef<"div">,
  "children" | "title"
> {
  children: ReactNode;
  columns?: AttributesColumns;
  title: ReactNode;
  variant?: AttributesVariant;
}
const Root = forwardRef<HTMLDivElement, AttributesProps>(
  (
    {
      children,
      className,
      columns: count = 2,
      title,
      variant = "list",
      ...props
    },
    ref,
  ) => (
    <VariantContext.Provider value={variant}>
      <Widget ref={ref} className={cn("min-w-0", className)} {...props}>
        <Widget.Header>
          <Widget.Title>{title}</Widget.Title>
        </Widget.Header>
        <Widget.Content className={variant === "list" ? "p-0" : undefined}>
          <dl
            className={cn(
              "grid",
              variant === "card" && ["gap-x-8 gap-y-6", columns[count]],
            )}
          >
            {children}
          </dl>
        </Widget.Content>
      </Widget>
    </VariantContext.Provider>
  ),
);
Root.displayName = "Attributes.Root";
export interface AttributesItemProps extends Omit<
  ComponentPropsWithRef<"div">,
  "children"
> {
  children: ReactNode;
  icon?: ReactNode;
  label: ReactNode;
}
const Item = forwardRef<HTMLDivElement, AttributesItemProps>(
  ({ children, className, icon, label, ...props }, ref) => {
    const variant = useContext(VariantContext);
    return (
      <div
        ref={ref}
        className={cn(
          variant === "card"
            ? "grid min-w-0 gap-1"
            : "flex min-w-0 items-center justify-between gap-4 border-b border-separator px-4 py-3 last:border-0",
          className,
        )}
        {...props}
      >
        <dt className="flex min-w-0 items-center gap-2 text-sm font-medium text-muted">
          {icon ? (
            <span aria-hidden className="[&_svg]:size-4">
              {icon}
            </span>
          ) : null}
          {label}
        </dt>
        <dd
          className={cn(
            "min-w-0 text-sm font-medium",
            variant === "list" && "text-end font-semibold",
          )}
        >
          {children}
        </dd>
      </div>
    );
  },
);
Item.displayName = "Attributes.Item";
export const Attributes = Object.assign(Root, { Item, Root });
export { Item as AttributesItem, Root as AttributesRoot };
