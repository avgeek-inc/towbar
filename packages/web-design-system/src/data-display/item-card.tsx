"use client";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
function Root({
  className,
  variant: _variant,
  ...props
}: ComponentProps<"article"> & { variant?: string }) {
  return (
    <article
      className={cn(
        "flex items-center gap-4 rounded-2xl border border-separator bg-surface p-4",
        className,
      )}
      {...props}
    />
  );
}
function Content({ className, ...props }: ComponentProps<"div">) {
  return (
    <div className={cn("grid min-w-0 flex-1 gap-1", className)} {...props} />
  );
}
function Title({ className, ...props }: ComponentProps<"h4">) {
  return <h4 className={cn("font-medium", className)} {...props} />;
}
function Description({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-sm text-muted", className)} {...props} />;
}
function Action({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("shrink-0", className)} {...props} />;
}
export const ItemCard = Object.assign(Root, {
  Action,
  Content,
  Description,
  Root,
  Title,
});
