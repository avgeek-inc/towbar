import type { ReactNode } from "react";
import { Widget } from "@avgeek-oss/design-system/data-display/widget";
import { cn } from "@avgeek-oss/design-system/lib/utils";

export function MetricCard({
  children,
  className,
  icon,
  label,
  value,
}: {
  children?: ReactNode;
  className?: string;
  icon?: ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <Widget className={cn("min-w-0", className)}>
      <Widget.Header>
        <Widget.Title icon={icon}>{label}</Widget.Title>
      </Widget.Header>
      <Widget.Content className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        <span className="typography--h2 font-medium tracking-tight tabular-nums">
          {typeof value === "number"
            ? value.toLocaleString(undefined, { maximumFractionDigits: 0 })
            : value}
        </span>
        {children}
      </Widget.Content>
    </Widget>
  );
}
