"use client";

import { useContext, type ComponentProps } from "react";
import { cn } from "../lib/utils";
import { Widget } from "./widget";
import { WidgetContentContext } from "./widget-context";

function Root({ className, ...props }: ComponentProps<"div">) {
  const isInsideWidget = useContext(WidgetContentContext);
  const content = (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-5 px-6 py-10 text-center",
        className,
      )}
      {...props}
    />
  );
  if (isInsideWidget) return content;
  return (
    <Widget className="min-w-0">
      <Widget.Content className="p-0">{content}</Widget.Content>
    </Widget>
  );
}
function Header({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("grid justify-items-center gap-1.5", className)}
      {...props}
    />
  );
}
function Title({ className, ...props }: ComponentProps<"h3">) {
  return <h3 className={cn("text-base font-semibold", className)} {...props} />;
}
function Description({ className, ...props }: ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted", className)} {...props} />;
}
function Content({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-center gap-3", className)}
      {...props}
    />
  );
}
function Media({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("text-muted", className)} {...props} />;
}

export const EmptyState = Object.assign(Root, {
  Content,
  Description,
  Header,
  Media,
  Root,
  Title,
});
export type EmptyStateProps = ComponentProps<typeof Root>;
