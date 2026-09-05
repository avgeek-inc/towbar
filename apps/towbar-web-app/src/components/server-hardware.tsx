import Image from "next/image";
import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import { CpuIcon, RamMemoryIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Server } from "@workspace/towbar-web-client";
import { formatBytes } from "./runtime-operations";

export function ServerHardwareDescription({
  hardware,
}: {
  hardware?: Server["hardware"];
}) {
  if (hardware?.instance)
    return <ServerInstanceDescription instance={hardware.instance} />;
  if (!hardware?.cpuCount && !hardware?.memoryBytes)
    return <span>Unknown Instance Type</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {hardware.cpuCount ? (
        <span className="inline-flex items-center gap-0.5 whitespace-nowrap">
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
          className="inline-flex items-center gap-0.5 whitespace-nowrap"
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

const providerNames = {
  aws: "Amazon Web Services",
  azure: "Microsoft Azure",
  gcp: "Google Cloud",
} as const;

export function ServerInstanceDescription({
  instance,
}: {
  instance: NonNullable<NonNullable<Server["hardware"]>["instance"]>;
}) {
  const provider = providerNames[instance.provider];
  return (
    <span className="inline-flex items-center gap-1.5">
      {provider ? (
        <TooltipText
          className="inline-flex shrink-0 items-center"
          tooltip={provider}
        >
          <Image
            alt={provider}
            src={`/cloud-providers/${instance.provider}.svg`}
            width={instance.provider === "aws" ? 24 : 16}
            height={16}
            className="h-[1em] w-auto object-contain"
          />
        </TooltipText>
      ) : null}
      <span>{instance.type}</span>
    </span>
  );
}
