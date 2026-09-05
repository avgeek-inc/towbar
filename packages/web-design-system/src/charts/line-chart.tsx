"use client";

import type { ComponentProps, ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart as RechartsLineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { cn } from "../lib/utils";

type Datum = Record<string, unknown>;
type RootProps = Omit<ComponentProps<"div">, "children"> & {
  children: ReactNode;
  data: Datum[];
  height?: number;
};
function Root({
  children,
  className,
  data,
  height = 240,
  ...props
}: RootProps) {
  return (
    <div className={cn("w-full", className)} style={{ height }} {...props}>
      <ResponsiveContainer height="100%" width="100%">
        <RechartsLineChart data={data}>{children}</RechartsLineChart>
      </ResponsiveContainer>
    </div>
  );
}

function Grid(props: ComponentProps<typeof CartesianGrid>) {
  return <CartesianGrid stroke="var(--separator)" {...props} />;
}

type TooltipEntry = {
  color?: string;
  dataKey?: string | number;
  name?: string | number;
  value?: string | number;
};
function TooltipContent({
  active,
  className,
  label,
  labelFormatter,
  payload,
}: {
  active?: boolean;
  className?: string;
  label?: unknown;
  labelFormatter?: (value: unknown) => ReactNode;
  payload?: TooltipEntry[];
}) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className={cn(
        "grid gap-1 rounded-xl border border-separator bg-surface p-3 text-xs shadow-lg",
        className,
      )}
    >
      <div className="font-medium">
        {labelFormatter ? labelFormatter(label) : String(label ?? "")}
      </div>
      {payload.map((item) => (
        <div
          className="flex items-center justify-between gap-6"
          key={String(item.dataKey ?? item.name)}
        >
          <span className="inline-flex items-center gap-2 text-muted">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.name}
          </span>
          <span className="font-medium tabular-nums">{item.value}</span>
        </div>
      ))}
    </div>
  );
}
export const LineChart = Object.assign(Root, {
  Grid,
  Line,
  Root,
  Tooltip,
  TooltipContent,
  XAxis,
  YAxis,
});
