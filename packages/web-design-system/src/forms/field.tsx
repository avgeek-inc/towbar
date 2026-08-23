"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid w-full gap-1.5", className)} {...props} />;
}
export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-5", className)} {...props} />;
}
export function FieldLabel({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}
export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}
export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      role="alert"
      className={cn("text-sm text-danger", className)}
      {...props}
    />
  );
}
export function FieldContent({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid gap-1", className)} {...props} />;
}
export function FieldTitle({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("font-medium", className)} {...props} />;
}
export function FieldSeparator({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("h-px bg-separator", className)} {...props} />;
}
export function FieldSet({ className, ...props }: ComponentProps<"fieldset">) {
  return <fieldset className={cn("grid gap-5", className)} {...props} />;
}
export function FieldLegend({ className, ...props }: ComponentProps<"legend">) {
  return <legend className={cn("font-semibold", className)} {...props} />;
}
