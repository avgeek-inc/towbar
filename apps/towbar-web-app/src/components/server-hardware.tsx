import { CpuIcon, RamMemoryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Server } from "@workspace/towbar-web-client";
import { formatBytes } from "./runtime-operations";

export function ServerHardwareDescription({
  hardware,
}: {
  hardware?: Server["hardware"];
}) {
  if (hardware?.instance) return <span>{hardware.instance.type}</span>;
  if (!hardware?.cpuCount && !hardware?.memoryBytes)
    return <span>Unknown Instance Type</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {hardware.cpuCount ? (
        <span className="inline-flex items-center gap-1 whitespace-nowrap">
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3.5 shrink-0"
            icon={CpuIcon}
          />
          {hardware.cpuCount} vCPU
        </span>
      ) : null}
      {hardware.memoryBytes ? (
        <span
          aria-label={`Memory: ${formatBytes(hardware.memoryBytes)}`}
          className="inline-flex items-center gap-1 whitespace-nowrap"
        >
          <HugeiconsIcon
            aria-hidden="true"
            className="size-3.5 shrink-0"
            icon={RamMemoryIcon}
          />
          {formatBytes(hardware.memoryBytes)}
        </span>
      ) : null}
    </span>
  );
}
