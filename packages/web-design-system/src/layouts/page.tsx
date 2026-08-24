import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";
type PageProps = ComponentProps<"div"> & {
  archetype?: string;
  auxiliary?: ReactNode;
  lead?: ReactNode;
  overlays?: ReactNode;
  structuredData?: object | readonly object[];
};
export function Page({
  auxiliary,
  children,
  className,
  lead,
  overlays,
  structuredData,
  ...props
}: PageProps) {
  return (
    <div className={cn("min-w-0", className)} {...props}>
      {structuredData ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
      ) : null}
      {lead}
      {children}
      {auxiliary}
      {overlays}
    </div>
  );
}
type PageSectionProps = ComponentProps<"div"> & {
  width?: "full" | "content";
  xPadding?: "none" | "default";
  yPadding?: "none" | "compact" | "default";
};
export function PageSection({
  className,
  width = "content",
  xPadding = "default",
  yPadding = "default",
  ...props
}: PageSectionProps) {
  return (
    <div
      className={cn(
        width === "content" && "mx-auto w-full max-w-7xl",
        xPadding === "default" && "px-4 sm:px-6 lg:px-8",
        yPadding === "default"
          ? "py-6 sm:py-10"
          : yPadding === "compact"
            ? "py-3 sm:py-6"
            : "py-0",
        className,
      )}
      {...props}
    />
  );
}
export type { PageProps, PageSectionProps };
