"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export function Field({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("grid w-full gap-1.5", className)} {...props} />;
}
export function FieldGroup({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("content-grid", className)} {...props} />;
}
export function FieldLabel({
  children,
  className,
  isRequired = false,
  ...props
}: ComponentProps<"label"> & { isRequired?: boolean }) {
  return (
    <label className={cn("text-sm font-medium", className)} {...props}>
      {children}
      {isRequired ? (
        <span aria-hidden="true" className="text-danger">
          {" "}
          *
        </span>
      ) : null}
    </label>
  );
}
export function FieldDescription({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "text-xs leading-relaxed font-normal text-muted",
        className,
      )}
      {...props}
    />
  );
}
export function FieldError({ className, ...props }: ComponentProps<"p">) {
  return (
    <p
      role="alert"
      className={cn("text-danger-soft-foreground text-sm", className)}
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
  return <fieldset className={cn("content-grid", className)} {...props} />;
}
export function FieldLegend({ className, ...props }: ComponentProps<"legend">) {
  return <legend className={cn("font-semibold", className)} {...props} />;
}
