import {
  Activity01Icon,
  ArrowDataTransferHorizontalIcon,
  CpuIcon,
  HardDriveIcon,
  RamMemoryIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

export function MonitoringMetricIcon({ metric }: { metric: string }) {
  const icon = metric.startsWith("cpu")
    ? CpuIcon
    : metric.startsWith("memory") || metric.startsWith("swap")
      ? RamMemoryIcon
      : metric.startsWith("network")
        ? ArrowDataTransferHorizontalIcon
        : metric.startsWith("disk") || metric.startsWith("dockerDisk")
          ? HardDriveIcon
          : Activity01Icon;
  return (
    <HugeiconsIcon icon={icon} aria-hidden="true" className="size-4 shrink-0" />
  );
}
