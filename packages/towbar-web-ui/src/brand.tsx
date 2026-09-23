import { BrandLockup } from "@workspace/web-design-system/media/brand-lockup";
import { cn } from "@workspace/web-design-system/lib/utils";
import { getTowbarBrandLogoSource } from "@workspace/towbar-web-ui/brand-assets";

import type { ComponentPropsWithoutRef } from "react";

const brandLogoSource = getTowbarBrandLogoSource("light");

export function TowbarBrandLogo({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-grid size-8 shrink-0 place-items-center",
        className,
      )}
      data-slot="towbar-brand-logo"
      {...props}
    >
      <img
        alt=""
        aria-hidden="true"
        className="size-8 object-contain"
        decoding="sync"
        fetchPriority="high"
        height={32}
        src={brandLogoSource}
        width={32}
      />
    </span>
  );
}

export function TowbarLockup() {
  return <BrandLockup logo={<TowbarBrandLogo />}>Towbar</BrandLockup>;
}
