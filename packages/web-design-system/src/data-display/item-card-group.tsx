import type { ComponentProps } from "react";
import { cn } from "../lib/utils";
export function ItemCardGroup({
  className,
  ...props
}: ComponentProps<"div"> & { variant?: string }) {
  return <div className={cn("grid gap-3", className)} {...props} />;
}
