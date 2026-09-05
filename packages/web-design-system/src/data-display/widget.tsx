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

interface WidgetTitleProps extends ComponentPropsWithRef<"span"> {
  icon?: ReactNode;
}

const Title = forwardRef<HTMLSpanElement, WidgetTitleProps>(
  ({ children, className, icon, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(
        "widget__title inline-flex min-w-0 items-center gap-2 font-medium text-xs [&_svg]:size-4 [&_svg]:shrink-0",
        className,
      )}
      data-slot="widget-title"
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      {children}
    </span>
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

const FooterDescription = forwardRef<
  HTMLParagraphElement,
  ComponentPropsWithRef<"p">
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("min-w-0 flex-1 text-xs text-muted", className)}
    data-slot="widget-footer-description"
    {...props}
  />
));

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
FooterDescription.displayName = "Widget.FooterDescription";
Legend.displayName = "Widget.Legend";
LegendItem.displayName = "Widget.LegendItem";

export const Widget = Object.assign(Root, {
  Content,
  Footer,
  FooterDescription,
  Header,
  Legend,
  LegendItem,
  Root,
  Title,
});
