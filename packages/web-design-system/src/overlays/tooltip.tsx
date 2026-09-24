"use client";

import {
  createElement,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type Ref,
} from "react";
import { Tooltip as HeroTooltip, type TooltipProps } from "@heroui/react";
import { cn } from "../lib/utils";

function TooltipRoot(props: TooltipProps) {
  return <HeroTooltip closeDelay={100} delay={250} {...props} />;
}

export function TooltipArrowShape() {
  return (
    <svg
      aria-hidden="true"
      data-slot="overlay-arrow"
      width="12"
      height="12"
      viewBox="0 0 12 12"
    >
      <path
        className="fill-overlay stroke-none"
        d="M0 0C5.48483 8 6.5 8 12 0Z"
      />
      <path
        className="fill-none"
        data-slot="tooltip-arrow-edge"
        d="M0 0C5.48483 8 6.5 8 12 0"
        strokeWidth="1"
      />
    </svg>
  );
}

function TooltipArrow(props: ComponentProps<typeof HeroTooltip.Arrow>) {
  return (
    <HeroTooltip.Arrow {...props}>
      <TooltipArrowShape />
    </HeroTooltip.Arrow>
  );
}

export const Tooltip = Object.assign(TooltipRoot, {
  Root: TooltipRoot,
  Trigger: HeroTooltip.Trigger,
  Content: HeroTooltip.Content,
  Arrow: TooltipArrow,
});
export type { TooltipProps } from "@heroui/react";

function visibleText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isClipped(element: HTMLElement) {
  const style = getComputedStyle(element);
  const clipsHorizontally =
    style.overflowX === "hidden" || style.overflowX === "clip";
  const clipsVertically =
    style.overflowY === "hidden" || style.overflowY === "clip";

  return (
    (clipsHorizontally &&
      element.clientWidth > 0 &&
      element.scrollWidth > element.clientWidth + 1) ||
    (clipsVertically &&
      element.clientHeight > 0 &&
      element.scrollHeight > element.clientHeight + 1)
  );
}

function isTextClipped(element: HTMLElement) {
  if (isClipped(element)) return true;

  const parent = element.parentElement;
  if (
    parent &&
    visibleText(parent.textContent ?? "") ===
      visibleText(element.textContent ?? "") &&
    isClipped(parent) &&
    (element.scrollWidth > parent.clientWidth + 1 ||
      element.scrollHeight > parent.clientHeight + 1)
  ) {
    return true;
  }

  return Array.from(element.querySelectorAll<HTMLElement>("*")).some(isClipped);
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

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
  const triggerRef = useRef<HTMLElement | null>(null);
  const [isRedundant, setIsRedundant] = useState(false);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    if (!trigger || typeof tooltip !== "string") {
      setIsRedundant(false);
      return;
    }

    const update = () => {
      const sameText =
        visibleText(trigger.textContent ?? "") === visibleText(tooltip);
      setIsRedundant(sameText && !isTextClipped(trigger));
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(trigger);
    if (trigger.parentElement) observer.observe(trigger.parentElement);
    return () => observer.disconnect();
  }, [children, tooltip]);

  if (!tooltip) {
    return createElement(Tag, { ...props, className, dateTime }, children);
  }
  return (
    <Tooltip isDisabled={isRedundant}>
      <Tooltip.Trigger<"span">
        {...props}
        role={props.role}
        tabIndex={isRedundant ? -1 : props.tabIndex}
        className={cn(
          "rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus",
          className,
        )}
        render={(triggerProps) =>
          createElement(Tag, {
            ...triggerProps,
            dateTime,
            ref: (node: HTMLElement | null) => {
              triggerRef.current = node;
              assignRef(triggerProps.ref, node);
            },
          })
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
