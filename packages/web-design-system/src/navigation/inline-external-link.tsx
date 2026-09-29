import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/utils";
import { TooltipText } from "../overlays/tooltip";

export type InlineExternalLinkProps = ComponentProps<"a"> & {
  href: string;
  tone?: "primary" | "secondary";
  tooltip?: ReactNode;
};

export function InlineExternalLink({
  children,
  className,
  rel = "noopener noreferrer",
  target = "_blank",
  tone = "primary",
  tooltip,
  ...props
}: InlineExternalLinkProps) {
  return (
    <a
      {...props}
      className={cn(
        "group/external-link inline-flex min-w-0 max-w-full items-baseline rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-focus",
        className,
      )}
      rel={rel}
      target={target}
    >
      <TooltipText
        className={cn(
          "min-w-0 truncate rounded-none underline decoration-dashed",
          tone === "secondary"
            ? "decoration-muted/20 underline-offset-2 group-hover/external-link:decoration-muted/60 group-focus-visible/external-link:decoration-muted/60"
            : "decoration-muted/30 underline-offset-4 group-hover/external-link:decoration-muted group-focus-visible/external-link:decoration-muted",
        )}
        tabIndex={-1}
        tooltip={tooltip}
      >
        {children}
      </TooltipText>
      {target === "_blank" ? (
        <>
          <sup
            aria-hidden="true"
            className={cn(
              "ml-px shrink-0 text-[0.7em] leading-none font-normal",
              tone === "secondary"
                ? "text-muted/20 group-hover/external-link:text-muted/60 group-focus-visible/external-link:text-muted/60"
                : "text-muted/30 group-hover/external-link:text-muted group-focus-visible/external-link:text-muted",
            )}
          >
            ↗
          </sup>
          <span className="sr-only"> (opens in a new tab)</span>
        </>
      ) : null}
    </a>
  );
}
