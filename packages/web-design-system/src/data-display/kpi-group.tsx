import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
function Root({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex overflow-hidden rounded-3xl border border-separator bg-surface",
        className,
      )}
      {...props}
    />
  );
}
function Separator({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden
      className={cn("my-5 w-px bg-separator", className)}
      {...props}
    />
  );
}
export const KPIGroup = Object.assign(Root, { Root, Separator });
