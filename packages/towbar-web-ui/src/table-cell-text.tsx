import type { ComponentProps, ComponentPropsWithoutRef } from "react";
import { cn } from "@workspace/web-design-system/lib/utils";

export const tableCellStackClassName =
  "grid min-w-0 gap-0.5 text-sm/5 font-normal";
export const tableCellDescriptionClassName = "text-xs/4 font-normal text-muted";

export function TableCellStack({
  as: Tag = "span",
  className,
  ...props
}: ComponentPropsWithoutRef<"span"> & { as?: "div" | "span" }) {
  return (
    <Tag
      {...props}
      data-slot="table-cell-stack"
      className={cn(tableCellStackClassName, className)}
    />
  );
}

export function TableCellDescription({
  children,
  className,
  title,
  ...props
}: ComponentProps<"span">) {
  const characters = typeof children === "string" ? Array.from(children) : null;
  const truncated = characters !== null && characters.length > 48;
  return (
    <span
      {...props}
      title={title ?? (truncated ? characters.join("") : undefined)}
      data-slot="table-cell-description"
      className={cn(tableCellDescriptionClassName, className)}
    >
      {truncated ? `${characters.slice(0, 47).join("")}…` : children}
    </span>
  );
}
