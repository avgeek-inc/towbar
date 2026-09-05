"use client";

import { createElement, type ComponentProps, type ElementType } from "react";
import { TooltipText } from "../overlays/tooltip";
import { cn } from "../lib/utils";

type Align = "start" | "center" | "end";
type Color = "default" | "muted" | "danger";
const align = {
  start: "text-start",
  center: "text-center",
  end: "text-end",
} as const;
const color = {
  default: "text-foreground",
  muted: "text-muted",
  danger: "text-danger-soft-foreground",
} as const;

export type TypographyHeadingProps = ComponentProps<"h1"> & {
  align?: Align;
  color?: Color;
  elementType?: `h${1 | 2 | 3 | 4 | 5 | 6}`;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
};
export function TypographyHeading({
  align: textAlign = "start",
  className,
  color: tone = "default",
  elementType,
  level = 1,
  ...props
}: TypographyHeadingProps) {
  const tag = elementType ?? (`h${level}` as const);
  const scale = {
    1: "text-4xl",
    2: "text-2xl",
    3: "text-2xl",
    4: "text-xl",
    5: "text-lg",
    6: "text-base",
  } as const;
  const weight = {
    1: "font-semibold",
    2: "font-medium",
    3: "font-semibold",
    4: "font-semibold",
    5: "font-semibold",
    6: "font-semibold",
  } as const;
  return createElement(tag, {
    className: cn(
      scale[level],
      weight[level],
      "tracking-tight",
      align[textAlign],
      color[tone],
      className,
    ),
    ...props,
  });
}
export type TypographyParagraphProps = ComponentProps<"p"> & {
  align?: Align;
  color?: Color;
  size?: "sm" | "md" | "lg";
  weight?: "normal" | "medium" | "semibold";
};
export function TypographyParagraph({
  align: textAlign = "start",
  className,
  color: tone = "default",
  size = "md",
  weight = "normal",
  ...props
}: TypographyParagraphProps) {
  return (
    <p
      className={cn(
        { sm: "text-sm", md: "text-base", lg: "text-lg" }[size],
        {
          normal: "font-normal",
          medium: "font-medium",
          semibold: "font-semibold",
        }[weight],
        align[textAlign],
        color[tone],
        className,
      )}
      {...props}
    />
  );
}
export type TypographyTextProps = ComponentProps<"span"> & {
  color?: Color;
  textRole?: "body" | "caption" | "label" | "supporting";
  weight?: "normal" | "medium" | "semibold";
};
export function TypographyText({
  className,
  color: tone = "default",
  textRole = "body",
  weight,
  ...props
}: TypographyTextProps) {
  return (
    <span
      className={cn(
        textRole === "caption"
          ? "text-xs"
          : textRole === "body"
            ? "text-base"
            : "text-sm",
        (textRole === "caption" || textRole === "supporting") && "text-muted",
        (textRole === "label" || weight === "medium") && "font-medium",
        weight === "semibold" && "font-semibold",
        color[tone],
        className,
      )}
      {...props}
    />
  );
}
export type TypographyCodeProps = ComponentProps<"code">;
export function TypographyCode({
  className,
  title,
  ...props
}: TypographyCodeProps) {
  return (
    <TooltipText
      as="code"
      tooltip={title}
      className={cn("rounded-md bg-default px-1.5 py-0.5 text-sm", className)}
      {...props}
    />
  );
}
export type TypographyProps = ComponentProps<"span"> & {
  elementType?: ElementType;
  type?: string;
};
export function Typography({
  elementType: Tag = "span",
  className,
  ...props
}: TypographyProps) {
  return <Tag className={cn("text-sm", className)} {...props} />;
}
export type TypographyProseProps = ComponentProps<"article">;
export function TypographyProse({ className, ...props }: TypographyProseProps) {
  return (
    <article
      className={cn("prose max-w-none dark:prose-invert", className)}
      {...props}
    />
  );
}
