"use client";

import { useCallback, useState } from "react";

import { BrandLockup } from "@workspace/web-design-system/media/brand-lockup";
import { cn } from "@workspace/web-design-system/lib/utils";
import {
  getTowbarBrandFaviconSource,
  getTowbarBrandLogoSource,
} from "@workspace/towbar-web-ui/brand-assets";

import type { ComponentPropsWithoutRef } from "react";

const fallbackLogoSource = getTowbarBrandFaviconSource();
const brandLogoSources = {
  dark: getTowbarBrandLogoSource("dark"),
  light: getTowbarBrandLogoSource("light"),
} as const;

export function TowbarBrandLogo({
  className,
  ...props
}: ComponentPropsWithoutRef<"span">) {
  const [failedSources, setFailedSources] = useState<Set<string>>(
    () => new Set(),
  );
  const markFailed = useCallback((source: string) => {
    setFailedSources((current) => {
      if (current.has(source)) return current;
      const next = new Set(current);
      next.add(source);
      return next;
    });
  }, []);

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
      {failedSources.has(brandLogoSources.light) ? (
        <img
          alt=""
          aria-hidden="true"
          className="col-start-1 row-start-1 size-8 object-contain dark:hidden"
          decoding="async"
          height={32}
          src={fallbackLogoSource}
          width={32}
        />
      ) : (
        <img
          alt=""
          aria-hidden="true"
          className="col-start-1 row-start-1 size-8 object-contain dark:hidden"
          decoding="async"
          height={32}
          onError={() => markFailed(brandLogoSources.light)}
          src={brandLogoSources.light}
          width={32}
        />
      )}
      {failedSources.has(brandLogoSources.dark) ? (
        <img
          alt=""
          aria-hidden="true"
          className="col-start-1 row-start-1 hidden size-8 object-contain dark:block"
          decoding="async"
          height={32}
          src={fallbackLogoSource}
          width={32}
        />
      ) : (
        <img
          alt=""
          aria-hidden="true"
          className="col-start-1 row-start-1 hidden size-8 object-contain dark:block"
          decoding="async"
          height={32}
          onError={() => markFailed(brandLogoSources.dark)}
          src={brandLogoSources.dark}
          width={32}
        />
      )}
    </span>
  );
}

export function TowbarLockup() {
  return <BrandLockup logo={<TowbarBrandLogo />}>Towbar</BrandLockup>;
}
