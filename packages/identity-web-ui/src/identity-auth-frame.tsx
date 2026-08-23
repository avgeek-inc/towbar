"use client";

import type { ReactNode } from "react";

import {
  TypographyHeading,
  TypographyParagraph,
  TypographyText,
} from "@workspace/web-design-system/typography/typography";
import type { ComponentRootProps } from "@workspace/web-design-system/lib/component-root-props";
import { cn } from "@workspace/web-design-system/lib/utils";

type IdentityAuthFrameProps = ComponentRootProps<
  "div",
  { children: ReactNode }
>;

export function IdentityAuthFrame({
  children,
  className,
  ...props
}: IdentityAuthFrameProps) {
  return (
    <div
      data-slot="identity-auth-shell"
      className={cn("w-full", className)}
      {...props}
    >
      <div data-slot="identity-auth-form-panel">
        <div data-slot="identity-auth-content" className="sm:max-w-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

export function IdentityAuthHeading({
  children,
  className,
  eyebrow,
  titleElementType = "h2",
  title,
  ...props
}: ComponentRootProps<
  "div",
  {
    children: ReactNode;
    eyebrow?: ReactNode;
    titleElementType?: "h1" | "h2";
    title: string;
  }
>) {
  return (
    <header
      data-slot="identity-auth-heading"
      className={cn("grid gap-3", className)}
      {...props}
    >
      {eyebrow ? (
        <TypographyText textRole="label">{eyebrow}</TypographyText>
      ) : null}
      <div data-slot="identity-auth-heading-copy" className="grid gap-1">
        <TypographyHeading elementType={titleElementType} level={2}>
          {title}
        </TypographyHeading>
        <TypographyParagraph color="muted">{children}</TypographyParagraph>
      </div>
    </header>
  );
}
