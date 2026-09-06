"use client";
import { ScoutOptionIcon } from "./scout-icons";
import { useId } from "react";
import { Label } from "@workspace/web-design-system/forms/label";
import { Input } from "@workspace/web-design-system/forms/input";
import { ListBox, Select } from "@workspace/web-design-system/forms/select";
import {
  Field,
  FieldLabel,
  FieldDescription,
} from "@workspace/web-design-system/forms/field";
import type {
  ScoutAlertCondition,
  ScoutAlertRuleInput,
  NotificationDestination,
} from "@workspace/towbar-web-client";

export type ScoutRule = ScoutAlertRuleInput & {
  id: string;
  mutedUntil: string | null;
  muteReason: string;
  evaluationState: string;
  evaluatedAt: string | null;
  observedValue: number | null;
  httpCheck?: {
    checked_at: string | null;
    state: string;
    status_code: number | null;
    latency_ms: number | null;
    reason: string | null;
  } | null;
};
export type ScoutIncident = {
  id: string;
  ruleId: string;
  ruleName: string;
  condition: ScoutAlertCondition;
  severity: string;
  deployableId: string | null;
  openedAt: string;
  resolvedAt: string | null;
  resolutionReason: string | null;
  lastValue: number | null;
  lastNotifiedAt: string | null;
};
export type ScoutRulesResponse = {
  canManage: boolean;
  rules: ScoutRule[];
  workloads: Array<{
    id: string;
    name: string;
    sourceId: string;
    kind: string;
  }>;
  settings: { mutedUntil: string | null; muteReason: string };
  destinations: NotificationDestination[];
  providers: { slack: boolean; smtp: boolean };
};
export const scoutMetrics = [
  {
    id: "httpAvailability",
    label: "Public HTTP endpoint",
    unit: "",
    factor: 1,
  },
  { id: "cpuPercent", label: "CPU usage", unit: "%", factor: 1 },
  { id: "memoryPercent", label: "Memory usage", unit: "%", factor: 1 },
  {
    id: "memoryUsedBytes",
    label: "Memory used",
    unit: "GiB",
    factor: 1024 ** 3,
  },
  { id: "diskPercent", label: "Root disk usage", unit: "%", factor: 1 },
  { id: "dockerDiskPercent", label: "Docker disk usage", unit: "%", factor: 1 },
  { id: "swapUsedBytes", label: "Swap used", unit: "GiB", factor: 1024 ** 3 },
  { id: "load1", label: "Load average (1 minute)", unit: "", factor: 1 },
  { id: "load5", label: "Load average (5 minutes)", unit: "", factor: 1 },
  { id: "load15", label: "Load average (15 minutes)", unit: "", factor: 1 },
  {
    id: "networkRxBytesPerSecond",
    label: "Network received",
    unit: "MiB/s",
    factor: 1024 ** 2,
  },
  {
    id: "networkTxBytesPerSecond",
    label: "Network sent",
    unit: "MiB/s",
    factor: 1024 ** 2,
  },
  {
    id: "diskReadBytesPerSecond",
    label: "Disk read",
    unit: "MiB/s",
    factor: 1024 ** 2,
  },
  {
    id: "diskWriteBytesPerSecond",
    label: "Disk written",
    unit: "MiB/s",
    factor: 1024 ** 2,
  },
  { id: "restarts", label: "Container restarts", unit: "restarts", factor: 1 },
  {
    id: "missingReports",
    label: "No Scout report for",
    unit: "minutes",
    factor: 60,
  },
] as const;
export function metricDefinition(metric: string) {
  return (
    scoutMetrics.find((m) => m.id === metric) ?? {
      id: metric,
      label: metric,
      unit: "",
      factor: 1,
    }
  );
}
export function scoutValue(value: number | null, metric: string) {
  if (metric === "httpAvailability")
    return value === null
      ? "No result"
      : value === 0
        ? "Available"
        : "Unavailable";
  const definition = metricDefinition(metric);
  return value === null
    ? "No measurement"
    : `${(value / definition.factor).toLocaleString(undefined, { maximumFractionDigits: 2 })}${definition.unit === "%" ? "" : " "}${definition.unit}`.trim();
}
export function conditionDescription(condition: ScoutAlertCondition) {
  if (condition.metric === "httpAvailability") return `Endpoint unavailable`;
  return `${metricDefinition(condition.metric).label} ${condition.operator === "above" ? "at least" : "at most"} ${scoutValue(condition.threshold, condition.metric)}${condition.metric === "restarts" ? ` in ${condition.windowSeconds / 60} minutes` : ""}`;
}
export function ScoutSelect({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      aria-label={label}
      selectedKey={value}
      onSelectionChange={(key) => key !== null && onChange(String(key))}
      variant="secondary"
      isDisabled={disabled}
      className="min-w-0"
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((option) => (
            <ListBox.Item
              id={option.id}
              key={option.id}
              textValue={option.label}
            >
              <span className="inline-flex items-center gap-2">
                <ScoutOptionIcon value={option.id} label={label} />
                {option.label}
              </span>
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}
export function ScoutNumber({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  description,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
}) {
  const id = useId();
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        required
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? String(value) : ""}
        onChange={(e) =>
          onChange(
            e.currentTarget.value === "" ? NaN : Number(e.currentTarget.value),
          )
        }
        variant="secondary"
      />
      {description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}
