"use client";

import {
  forwardRef,
  type ComponentPropsWithRef,
  type CSSProperties,
} from "react";
import { cn } from "../lib/utils";

const Root = forwardRef<HTMLElement, ComponentPropsWithRef<"section">>(
  ({ className, ...props }, ref) => (
    <section
      ref={ref}
      className={cn(
        "overflow-hidden rounded-3xl border border-separator bg-surface",
        className,
      )}
      data-slot="widget"
      {...props}
    />
  ),
);

const Header = forwardRef<HTMLElement, ComponentPropsWithRef<"header">>(
  ({ className, ...props }, ref) => (
    <header
      ref={ref}
      className={cn(
        "flex min-h-12 items-center justify-between gap-4 border-b border-separator px-5 py-3",
        className,
      )}
      data-slot="widget-header"
      {...props}
    />
  ),
);

const Title = forwardRef<HTMLSpanElement, ComponentPropsWithRef<"span">>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn("text-xs font-medium text-muted", className)}
      data-slot="widget-title"
      {...props}
    />
  ),
);

const Content = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("p-5", className)}
      data-slot="widget-content"
      {...props}
    />
  ),
);

const Legend = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-2.5 text-[0.6875rem] leading-4 text-muted",
        className,
      )}
      data-slot="widget-legend"
      {...props}
    />
  ),
);

const LegendItem = forwardRef<
  HTMLSpanElement,
  ComponentPropsWithRef<"span"> & { color: string }
>(({ color, className, children, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("inline-flex items-center gap-1", className)}
    data-slot="widget-legend-item"
    {...props}
  >
    <span
      aria-hidden="true"
      className="size-1.5 rounded-full"
      style={{ backgroundColor: color } as CSSProperties}
    />
    {children}
  </span>
));

Root.displayName = "Widget.Root";
Header.displayName = "Widget.Header";
Title.displayName = "Widget.Title";
Content.displayName = "Widget.Content";
Legend.displayName = "Widget.Legend";
LegendItem.displayName = "Widget.LegendItem";

export const Widget = Object.assign(Root, {
  Content,
  Header,
  Legend,
  LegendItem,
  Root,
  Title,
});
