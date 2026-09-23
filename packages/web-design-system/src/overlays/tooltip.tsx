"use client";

import { createElement, type ComponentProps, type ReactNode } from "react";
import { Tooltip as HeroTooltip, type TooltipProps } from "@heroui/react";
import { cn } from "../lib/utils";

function TooltipRoot(props: TooltipProps) {
  return <HeroTooltip closeDelay={100} delay={250} {...props} />;
}

export const Tooltip = Object.assign(TooltipRoot, {
  Root: TooltipRoot,
  Trigger: HeroTooltip.Trigger,
  Content: HeroTooltip.Content,
  Arrow: HeroTooltip.Arrow,
});
export type { TooltipProps } from "@heroui/react";

/** A focusable text or icon hint with no browser-native title attribute. */
export function TooltipText({
  as: Tag = "span",
  tooltip,
  placement = "top",
  children,
  className,
  dateTime,
  ...props
}: Omit<ComponentProps<"span">, "title"> & {
  as?: "span" | "time" | "code";
  dateTime?: string;
  tooltip?: ReactNode;
  placement?: ComponentProps<typeof HeroTooltip.Content>["placement"];
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
        className="max-w-[min(16rem,calc(100vw-2rem))] whitespace-normal text-xs [overflow-wrap:anywhere]"
        placement={placement}
        showArrow
      >
        <Tooltip.Arrow />
        {tooltip}
      </Tooltip.Content>
    </Tooltip>
  );
}
