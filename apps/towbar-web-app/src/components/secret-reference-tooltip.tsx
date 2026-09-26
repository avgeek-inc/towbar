"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Tooltip } from "@workspace/web-design-system/overlays/tooltip";

export function SecretReferenceTooltip({
  children,
  reference,
  reveal,
}: {
  children: ReactNode;
  reference: string;
  reveal?: () => Promise<string>;
}) {
  const generation = useRef(0);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string>();

  useEffect(() => {
    const request = generation;
    const clear = () => {
      request.current++;
      setOpen(false);
      setPreview(undefined);
    };
    window.addEventListener("blur", clear);
    return () => {
      request.current++;
      window.removeEventListener("blur", clear);
    };
  }, []);

  async function changeOpen(next: boolean) {
    setOpen(next);
    const current = ++generation.current;
    if (!next) {
      setPreview(undefined);
      return;
    }
    if (!reveal) {
      setPreview("You don't have permission to view this value");
      return;
    }
    setPreview("Loading value…");
    try {
      const value = await reveal();
      if (current === generation.current) setPreview(value || "Empty value");
    } catch {
      if (current === generation.current)
        setPreview("Unable to show shared secret value");
    }
  }

  return (
    <Tooltip isOpen={open} onOpenChange={(next) => void changeOpen(next)}>
      <Tooltip.Trigger
        render={(props) => <div {...props} />}
        aria-label={`Shared secret reference ${reference}`}
        onMouseEnter={() => void changeOpen(true)}
        onMouseLeave={() => void changeOpen(false)}
      >
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content
        className="max-w-[min(24rem,calc(100vw-2rem))] whitespace-pre-wrap text-xs [overflow-wrap:anywhere]"
        placement="top"
        showArrow
      >
        <Tooltip.Arrow />
        {preview ?? "Loading value…"}
      </Tooltip.Content>
    </Tooltip>
  );
}
