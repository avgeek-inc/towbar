import type { ComponentPropsWithoutRef } from "react";

import { BrandLockup } from "@workspace/web-design-system/media/brand-lockup";

export function TowbarMark({
  className = "size-8",
  ...props
}: ComponentPropsWithoutRef<"span">) {
  return (
    <span
      aria-hidden="true"
      className={`${className} bg-foreground text-background typography--body-sm inline-grid shrink-0 place-items-center rounded-xl font-semibold`}
      {...props}
    >
      T
    </span>
  );
}

export function TowbarLockup() {
  return <BrandLockup logo={<TowbarMark />}>Towbar</BrandLockup>;
}
