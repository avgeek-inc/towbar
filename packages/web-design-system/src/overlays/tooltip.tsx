"use client";

import { createElement, type ComponentProps, type ReactNode } from "react";
import { Tooltip } from "@heroui/react";
import { cn } from "../lib/utils";

export { Tooltip };
export type { TooltipProps } from "@heroui/react";

/** A focusable text or icon hint with no browser-native title attribute. */
export function TooltipText({
  as: Tag = "span",
  tooltip,
  children,
  className,
  dateTime,
  ...props
}: Omit<ComponentProps<"span">, "title"> & {
  as?: "span" | "time" | "code";
  dateTime?: string;
  tooltip?: ReactNode;
}) {
  if (!tooltip) {
    return createElement(Tag, { ...props, className, dateTime }, children);
  }
  return (
    <Tooltip>
      <Tooltip.Trigger<"span">
        {...props}
        role={props.role}
        className={cn(
          "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus",
          className,
        )}
        render={(triggerProps) =>
          createElement(Tag, { ...triggerProps, dateTime })
        }
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content
        className="max-w-xs break-words text-xs"
        placement="top"
        showArrow
      >
        <Tooltip.Arrow />
        {tooltip}
      </Tooltip.Content>
    </Tooltip>
  );
}
