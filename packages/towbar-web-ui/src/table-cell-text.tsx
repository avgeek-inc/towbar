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
  className,
  ...props
}: ComponentProps<"span">) {
  return (
    <span
      {...props}
      data-slot="table-cell-description"
      className={cn(tableCellDescriptionClassName, className)}
    />
  );
}
