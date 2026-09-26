"use client";

import { useEffect, useRef, useState } from "react";
import { Tooltip } from "@workspace/web-design-system/overlays/tooltip";

export function SecretVariableTooltip({
  name,
  value,
  configured,
  reveal,
}: {
  name: string;
  value: string;
  configured: boolean;
  reveal?: () => Promise<string>;
}) {
  const generation = useRef(0);
  const opened = useRef(false);
  const cached = useRef<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string>();

  useEffect(() => {
    const request = generation;
    const openState = opened;
    const cachedValue = cached;
    const clear = () => {
      request.current++;
      openState.current = false;
      cachedValue.current = undefined;
      setOpen(false);
      setPreview(undefined);
    };
    window.addEventListener("blur", clear);
    return () => {
      request.current++;
      window.removeEventListener("blur", clear);
    };
  }, []);

  async function show() {
    const current = ++generation.current;
    if (!configured) {
      setPreview(value || "Empty value");
      return;
    }
    if (!reveal) {
      setPreview("You don't have permission to view this value");
      return;
    }
    if (cached.current !== undefined) {
      setPreview(cached.current || "Empty value");
      return;
    }
    setPreview("Loading value…");
    try {
      const result = await reveal();
      if (current === generation.current) {
        cached.current = result;
        setPreview(result || "Empty value");
      }
    } catch (error) {
      if (current === generation.current)
        setPreview(
          error instanceof Error ? error.message : "Unable to show value",
        );
    }
  }

  function changeOpen(next: boolean) {
    if (next === opened.current) return;
    opened.current = next;
    setOpen(next);
    if (next) void show();
    else {
      generation.current++;
      setPreview(undefined);
    }
  }

  const content = configured
    ? reveal
      ? (preview ?? "Loading value…")
      : "You don't have permission to view this value"
    : value || "Empty value";

  return (
    <Tooltip isOpen={open} onOpenChange={changeOpen}>
      <Tooltip.Trigger
        render={(props) => <span {...props} />}
        className="break-all rounded-sm font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-focus"
        tabIndex={0}
        onMouseEnter={() => changeOpen(true)}
        onMouseLeave={() => changeOpen(false)}
        onFocus={() => changeOpen(true)}
        onBlur={() => changeOpen(false)}
      >
        {name}
      </Tooltip.Trigger>
      <Tooltip.Content
        className="max-w-[min(24rem,calc(100vw-2rem))] whitespace-pre-wrap text-xs [overflow-wrap:anywhere]"
        placement="top"
        showArrow
      >
        <Tooltip.Arrow />
        {content}
      </Tooltip.Content>
    </Tooltip>
  );
}
