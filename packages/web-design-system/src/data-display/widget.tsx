"use client";

import { forwardRef, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "../lib/utils";

const Root = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("widget", className)}
      data-slot="widget"
      {...props}
    />
  ),
);

interface WidgetHeaderProps extends Omit<
  ComponentPropsWithRef<"div">,
  "children"
> {
  children: ReactNode;
  endContent?: ReactNode;
}

const Header = forwardRef<HTMLDivElement, WidgetHeaderProps>(
  ({ children, className, endContent, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("widget__header", className)}
      data-slot="widget-header"
      {...props}
    >
      {children}
      {endContent}
    </div>
  ),
);

const Title = forwardRef<HTMLSpanElement, ComponentPropsWithRef<"span">>(
  ({ className, ...props }, ref) => (
    <span
      ref={ref}
      className={cn("widget__title font-medium text-xs", className)}
      data-slot="widget-title"
      {...props}
    />
  ),
);

const Content = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("widget__content", className)}
      data-slot="widget-content"
      {...props}
    />
  ),
);

const Footer = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("widget__footer", className)}
      data-slot="widget-footer"
      {...props}
    />
  ),
);

const Legend = forwardRef<HTMLDivElement, ComponentPropsWithRef<"div">>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn("widget__legend", className)}
      data-slot="widget-legend"
      {...props}
    />
  ),
);

const LegendItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithRef<"div"> & { color: string }
>(({ color, className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("widget__legend-item", className)}
    data-slot="widget-legend-item"
    {...props}
  >
    <span
      className="widget__legend-item-dot"
      data-slot="widget-legend-item-dot"
      style={{ backgroundColor: color }}
    />
    <span
      className="widget__legend-item-label"
      data-slot="widget-legend-item-label"
    >
      {children}
    </span>
  </div>
));

Root.displayName = "Widget.Root";
Header.displayName = "Widget.Header";
Title.displayName = "Widget.Title";
Content.displayName = "Widget.Content";
Footer.displayName = "Widget.Footer";
Legend.displayName = "Widget.Legend";
LegendItem.displayName = "Widget.LegendItem";

export const Widget = Object.assign(Root, {
  Content,
  Footer,
  Header,
  Legend,
  LegendItem,
  Root,
  Title,
});
