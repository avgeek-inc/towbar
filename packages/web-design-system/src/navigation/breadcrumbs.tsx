"use client";

import { TooltipText } from "../overlays/tooltip";

import type { MouseEvent } from "react";

import { cn } from "../lib/utils";
import type { AppShellBreadcrumbItems } from "../layouts/application-shell-types";
import { useAppNavigate } from "./app-layout";

export function BreadcrumbTrail({
  className,
  items,
}: {
  className?: string;
  items: AppShellBreadcrumbItems;
}) {
  const navigate = useAppNavigate();
  const visibleItems = items.filter(
    (item, index) => !(index === 0 && item.href === "/"),
  );

  if (visibleItems.length === 0) return null;

  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("min-w-0 overflow-hidden", className)}
      data-slot="breadcrumb"
    >
      <ol className="flex min-w-0 items-center gap-2 overflow-hidden text-sm whitespace-nowrap">
        {visibleItems.map((item, index) => {
          const isLast = index === visibleItems.length - 1;
          return (
            <li
              className={cn(
                "flex min-w-0 items-center gap-2",
                isLast ? "flex-1" : "shrink",
              )}
              key={`${item.href ?? item.label}-${index}`}
            >
              {index > 0 ? (
                <span aria-hidden="true" className="text-muted">
                  /
                </span>
              ) : null}
              {item.href && !isLast ? (
                <a
                  className="block min-w-0 max-w-40 truncate text-muted hover:text-foreground sm:max-w-64"
                  href={item.href}
                  onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                    if (!navigate) return;
                    event.preventDefault();
                    navigate(item.href!);
                  }}
                >
                  <TooltipText tooltip={item.label} tabIndex={-1}>
                    {item.label}
                  </TooltipText>
                </a>
              ) : (
                <TooltipText
                  aria-current={isLast ? "page" : undefined}
                  className="block min-w-0 truncate font-medium text-foreground"
                  tooltip={item.label}
                >
                  {item.label}
                </TooltipText>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
