import type { ReactNode } from "react";

import { KPI } from "@workspace/web-design-system/data-display/kpi";

export function MetricCard({
  children,
  label,
  value,
}: {
  children?: ReactNode;
  label: string;
  value: number | string;
}) {
  return (
    <KPI className="min-w-0">
      <KPI.Header>
        <KPI.Title>{label}</KPI.Title>
      </KPI.Header>
      <KPI.Content className="grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
        {typeof value === "number" ? (
          <KPI.Value maximumFractionDigits={0} value={value} />
        ) : (
          <dd className="typography--h2 tracking-tight font-semibold">
            {value}
          </dd>
        )}
        {children}
      </KPI.Content>
    </KPI>
  );
}
