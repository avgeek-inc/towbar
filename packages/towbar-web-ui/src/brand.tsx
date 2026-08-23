import type { ComponentPropsWithoutRef } from "react";

import { TypographyText } from "@workspace/web-design-system/typography/typography";

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
  return (
    <span className="inline-flex items-center gap-2.5">
      <TowbarMark />
      <TypographyText weight="semibold">Towbar</TypographyText>
    </span>
  );
}
