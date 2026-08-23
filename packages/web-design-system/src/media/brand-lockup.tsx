"use client";

import { forwardRef, type ReactNode } from "react";

import type { ComponentRootProps } from "../lib/component-root-props";
import { cn } from "../lib/utils";
import { TypographyText } from "../typography/typography";

export type BrandLockupProps = ComponentRootProps<
  "span",
  {
    children: ReactNode;
    logo: ReactNode;
  }
>;

export const BrandLockup = forwardRef<HTMLSpanElement, BrandLockupProps>(
  ({ children, className, logo, ...props }, ref) => (
    <span
      ref={ref}
      className={cn("inline-flex min-w-0 items-center gap-2.5", className)}
      data-slot="brand-lockup"
      {...props}
    >
      <span
        aria-hidden="true"
        className="inline-grid size-8 shrink-0 place-items-center"
        data-slot="brand-lockup-logo"
      >
        {logo}
      </span>
      <TypographyText
        className="truncate"
        data-slot="brand-lockup-label"
        weight="medium"
      >
        {children}
      </TypographyText>
    </span>
  ),
);

BrandLockup.displayName = "BrandLockup";
