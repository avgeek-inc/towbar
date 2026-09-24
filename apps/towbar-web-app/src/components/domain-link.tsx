import type { ComponentProps } from "react";
import { cn } from "@workspace/web-design-system/lib/utils";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";

export function DomainLink({
  className,
  children,
  domain,
  target = "_blank",
  title = domain,
  showTooltip = true,
  ...props
}: Omit<ComponentProps<"a">, "href"> & {
  domain: string;
  showTooltip?: boolean;
}) {
  return (
    <a
      className={cn(
        "focus-visible:ring-focus inline-flex min-w-0 max-w-full items-center rounded-sm outline-none focus-visible:ring-2",
        className,
      )}
      href={`https://${domain}`}
      rel="noopener noreferrer"
      target={target}
      aria-label={
        typeof children === "string" && children !== domain
          ? `${domain}${target === "_blank" ? " (opens in a new tab)" : ""}`
          : undefined
      }
      {...props}
    >
      {showTooltip ? (
        <TooltipText
          className="min-w-0 truncate underline decoration-dashed decoration-muted underline-offset-4"
          tabIndex={-1}
          tooltip={title}
        >
          {children}
        </TooltipText>
      ) : (
        <span className="min-w-0 truncate underline decoration-dashed decoration-muted underline-offset-4">
          {children}
        </span>
      )}
      {target === "_blank" ? <NewTabIndicator /> : null}
    </a>
  );
}
