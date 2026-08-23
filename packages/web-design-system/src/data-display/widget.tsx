"use client";

import type { ComponentProps, CSSProperties } from "react";
import { cn } from "../lib/utils";

function Root({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-separator bg-surface",
        className,
      )}
      {...props}
    />
  );
}
function Header({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      className={cn(
        "flex min-h-12 items-center justify-between gap-4 border-b border-separator px-5 py-3",
        className,
      )}
      {...props}
    />
  );
}
function Title({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("text-sm font-medium", className)} {...props} />;
}
function Content({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("p-5", className)} {...props} />;
}
function Legend({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center gap-4 text-xs text-muted", className)}
      {...props}
    />
  );
}
function LegendItem({
  color,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { color: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5", className)}
      {...props}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ backgroundColor: color } as CSSProperties}
      />
      {children}
    </span>
  );
}

export const Widget = Object.assign(Root, {
  Content,
  Header,
  Legend,
  LegendItem,
  Root,
  Title,
});
