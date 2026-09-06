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
  if (hardware?.instance?.type)
    return <ServerInstanceDescription instance={hardware.instance} />;
  if (!hardware?.cpuCount && !hardware?.memoryBytes)
    return hardware?.instance ? (
      <ServerInstanceDescription instance={hardware.instance} />
    ) : (
      <span>Unknown Instance Type</span>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {hardware.instance ? (
        <ProviderLogo provider={hardware.instance.provider} />
      ) : null}
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
  oracle: "Oracle Cloud",
  hetzner: "Hetzner",
  digitalocean: "DigitalOcean",
  linode: "Akamai / Linode",
  alibaba: "Alibaba Cloud",
} as const;

export function ServerInstanceDescription({
  instance,
}: {
  instance: NonNullable<NonNullable<Server["hardware"]>["instance"]>;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <ProviderLogo provider={instance.provider} />
      <span>{instance.type ?? providerNames[instance.provider]}</span>
    </span>
  );
}

function ProviderLogo({ provider }: { provider: keyof typeof providerNames }) {
  return (
    <TooltipText
      className="inline-flex shrink-0 items-center"
      tooltip={providerNames[provider]}
    >
      <Image
        alt={providerNames[provider]}
        src={`/cloud-providers/${provider}.svg`}
        width={provider === "aws" ? 24 : 16}
        height={16}
        className="h-[1em] w-auto object-contain"
      />
    </TooltipText>
  );
}
