"use client";

import { useState } from "react";
import Image from "next/image";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerIcon,
  SmartPhone01Icon,
  Tablet01Icon,
  RoboticIcon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";

const browsers: Record<string, string> = {
  Chrome: "chrome",
  Firefox: "firefox",
  Safari: "safari",
  Edge: "edge",
};
const devices = {
  Desktop: ComputerIcon,
  Mobile: SmartPhone01Icon,
  Tablet: Tablet01Icon,
  Bot: RoboticIcon,
};

export function AnalyticsRowIcon({
  dimension,
  value,
}: {
  dimension: string;
  value: string;
}) {
  const [failed, setFailed] = useState(false);
  if (dimension === "status") {
    const status = Number(value);
    return (
      <span
        aria-hidden="true"
        className={`size-1.5 shrink-0 rounded-full ${status >= 200 && status < 300 ? "bg-success" : status >= 400 && status < 600 ? "bg-danger" : "bg-muted"}`}
      />
    );
  }
  if (dimension === "device")
    return (
      <HugeiconsIcon
        aria-hidden="true"
        className="size-4 shrink-0 text-muted"
        icon={devices[value as keyof typeof devices] ?? ComputerIcon}
      />
    );
  if (dimension !== "browser" && dimension !== "referrer") return null;
  const src =
    dimension === "browser" && browsers[value]
      ? `/browsers/${browsers[value]}.png`
      : dimension === "referrer" &&
          /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/u.test(value)
        ? `https://${value}/favicon.ico`
        : null;
  if (!src || failed)
    return (
      <span className="inline-flex size-5 shrink-0 items-center justify-center text-foreground">
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4"
          icon={Globe02Icon}
        />
      </span>
    );
  return (
    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-white p-0.5">
      <Image
        alt=""
        width={16}
        height={16}
        className="size-4 shrink-0 object-contain"
        src={src}
        unoptimized
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
