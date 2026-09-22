"use client";

import { Button as HeroButton, Link as HeroLink } from "@heroui/react";
import { buttonVariants as heroButtonVariants } from "@heroui/styles";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export type ButtonVariant =
  NonNullable<ComponentProps<typeof HeroButton>["variant"]> | "danger-ghost";
export type ButtonProps = Omit<
  ComponentProps<typeof HeroButton>,
  "size" | "variant"
> & {
  variant?: ButtonVariant;
};

export function Button({
  className,
  type = "button",
  variant,
  ...props
}: ButtonProps) {
  const variantClass = variant === "danger-ghost" && "button--danger-ghost";
  const resolvedVariant =
    variant === "danger-ghost"
      ? "ghost"
      : variant === "danger"
        ? "danger-soft"
        : variant;
  return (
    <HeroButton
      {...props}
      type={type}
      size="sm"
      variant={resolvedVariant}
      className={
        typeof className === "function"
          ? (state) => cn(variantClass, className(state))
          : cn(variantClass, className)
      }
    />
  );
}

export type ButtonLinkProps = Omit<
  ComponentProps<typeof HeroLink>,
  "className" | "size"
> & {
  className?: string;
  variant?: ButtonVariant;
};

export function ButtonLink({
  className,
  style,
  variant,
  ...props
}: ButtonLinkProps) {
  return (
    <HeroLink
      className={buttonVariants({
        // HeroUI resets .link.button to gap-0; restore the normal button spacing.
        className: cn("gap-1.5", className),
        variant,
      })}
      style={{ color: "var(--button-fg)", ...style }}
      {...props}
    />
  );
}

type ButtonVariantOptions = Omit<
  NonNullable<Parameters<typeof heroButtonVariants>[0]>,
  "size" | "variant"
> & { variant?: ButtonVariant };

export function buttonVariants({
  class: classValue,
  className,
  variant,
  ...props
}: ButtonVariantOptions = {}) {
  const resolvedVariant =
    variant === "danger-ghost"
      ? "ghost"
      : variant === "danger"
        ? "danger-soft"
        : variant;
  return heroButtonVariants({
    ...props,
    size: "sm",
    variant: resolvedVariant,
    className: cn(
      variant === "danger-ghost" && "button--danger-ghost",
      classValue,
      className,
    ),
  });
}
