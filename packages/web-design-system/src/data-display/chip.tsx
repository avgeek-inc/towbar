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
  icon?: ReactNode;
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
  icon,
  size,
  variant,
  ...props
}: ChipProps) {
  const numeric =
    typeof children === "number" ||
    (typeof children === "string" &&
      /^\s*[+-]?\d[\d,]*(?:\.\d+)?\s*$/.test(children));
  return (
    <HeroChip
      aria-busy={loading || undefined}
      color={variant ? colors[variant] : undefined}
      size={size ? sizes[size] : undefined}
      variant="soft"
      {...props}
    >
      {loading ? <Spinner color="current" size="sm" /> : null}
      <HeroChip.Label
        className={`inline-flex items-center gap-1.5 whitespace-nowrap font-normal${numeric ? " font-mono tabular-nums" : ""}`}
      >
        {!loading && icon ? (
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 [&_svg]:size-3.5 [&_svg]:text-current"
          >
            {icon}
          </span>
        ) : null}
        {children}
      </HeroChip.Label>
    </HeroChip>
  );
}
