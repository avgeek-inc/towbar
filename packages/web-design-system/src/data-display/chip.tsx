"use client";

import { Chip as HeroChip, Spinner } from "@heroui/react";
import type { ComponentProps, ReactNode } from "react";

type ChipVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "success"
  | "warning"
  | "info"
  | "yellow";
type ChipSize = "small" | "default" | "large";
export type ChipProps = Omit<
  ComponentProps<typeof HeroChip>,
  "children" | "color" | "size" | "variant"
> & {
  children?: ReactNode;
  loading?: boolean;
  size?: ChipSize;
  variant?: ChipVariant;
};

const colors = {
  default: "accent",
  secondary: "default",
  destructive: "danger",
  success: "success",
  warning: "warning",
  info: "accent",
  yellow: "warning",
} as const;
const sizes = { small: "sm", default: "md", large: "lg" } as const;

export function Chip({
  children,
  loading,
  size,
  variant,
  ...props
}: ChipProps) {
  return (
    <HeroChip
      aria-busy={loading || undefined}
      color={variant ? colors[variant] : undefined}
      size={size ? sizes[size] : undefined}
      variant="soft"
      {...props}
    >
      {loading ? <Spinner color="current" size="sm" /> : null}
      <HeroChip.Label className="whitespace-nowrap">{children}</HeroChip.Label>
    </HeroChip>
  );
}
