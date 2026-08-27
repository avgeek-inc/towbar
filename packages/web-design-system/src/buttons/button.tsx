"use client";

import { Button as HeroButton, Link as HeroLink } from "@heroui/react";
import { buttonVariants } from "@heroui/styles";
import type { ComponentProps } from "react";

export type ButtonProps = ComponentProps<typeof HeroButton>;
export type ButtonVariant = NonNullable<ButtonProps["variant"]>;
export type ButtonSize = NonNullable<ButtonProps["size"]>;

export function Button({ type = "button", ...props }: ButtonProps) {
  return <HeroButton type={type} {...props} />;
}

export type ButtonLinkProps = Omit<
  ComponentProps<typeof HeroLink>,
  "className"
> & {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export function ButtonLink({
  className,
  size,
  style,
  variant,
  ...props
}: ButtonLinkProps) {
  return (
    <HeroLink
      className={buttonVariants({ className, size, variant })}
      style={{ color: "var(--button-fg)", ...style }}
      {...props}
    />
  );
}

export { buttonVariants };
