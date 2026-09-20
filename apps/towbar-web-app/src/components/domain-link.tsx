import type { ComponentProps } from "react";
import { cn } from "@workspace/web-design-system/lib/utils";
import { NewTabIndicator } from "@workspace/web-design-system/navigation/new-tab-indicator";

export function DomainLink({
  className,
  children,
  domain,
  target = "_blank",
  title = domain,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { domain: string }) {
  return (
    <a
      className={cn(
        "focus-visible:ring-focus inline-flex min-w-0 max-w-full items-center rounded-sm decoration-dotted decoration-muted underline-offset-4 outline-none pointer-fine:hover:underline focus-visible:underline focus-visible:ring-2",
        className,
      )}
      href={`https://${domain}`}
      rel="noopener noreferrer"
      target={target}
      title={title}
      {...props}
    >
      <span className="min-w-0 truncate">{children}</span>
      {target === "_blank" ? <NewTabIndicator /> : null}
    </a>
  );
}
