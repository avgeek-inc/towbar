"use client";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
function Root({ className, ...props }: ComponentProps<"dl">) {
  return (
    <dl
      className={cn("grid min-w-0 flex-1 gap-3 px-6 py-5", className)}
      {...props}
    />
  );
}
function Header({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-between", className)}
      {...props}
    />
  );
}
function Title({ className, ...props }: ComponentProps<"dt">) {
  return (
    <dt
      className={cn("text-sm font-medium text-muted", className)}
      {...props}
    />
  );
}
function Content({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid grid-cols-1", className)} {...props} />;
}
function Value({
  value,
  maximumFractionDigits = 2,
  className,
  ...props
}: Omit<ComponentProps<"dd">, "children"> & {
  value: number;
  maximumFractionDigits?: number;
}) {
  return (
    <dd
      className={cn("text-3xl font-semibold tracking-tight", className)}
      {...props}
    >
      {new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(
        value,
      )}
    </dd>
  );
}
export const KPI = Object.assign(Root, { Content, Header, Root, Title, Value });
