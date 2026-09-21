"use client";

import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState, type CSSProperties } from "react";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Textarea } from "@workspace/web-design-system/forms/textarea";
import { toast } from "@workspace/web-design-system/overlays/toast";

export function SensitiveTextarea({
  id,
  value,
  onChange,
  placeholder,
  configured,
  required,
  disabled = false,
  reveal,
  rows = 6,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  configured: boolean;
  required?: boolean;
  disabled?: boolean;
  reveal?: () => Promise<string>;
  rows?: number;
}) {
  const [visible, setVisible] = useState(false);
  const [revealing, setRevealing] = useState(false);

  async function toggleVisibility() {
    if (visible) {
      setVisible(false);
      return;
    }
    setRevealing(true);
    try {
      if (!value && reveal) onChange(await reveal());
      setVisible(true);
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "Could not reveal secret",
      );
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="relative">
      <Textarea
        id={id}
        autoComplete="off"
        className="w-full pr-10 font-mono"
        disabled={disabled}
        placeholder={configured ? "••••••••••••" : placeholder}
        required={!configured && required}
        rows={rows}
        spellCheck={false}
        style={
          visible
            ? undefined
            : ({ WebkitTextSecurity: "disc" } as CSSProperties)
        }
        value={value}
        variant="secondary"
        onChange={(event) => onChange(event.currentTarget.value)}
      />
      <Button
        aria-label={visible ? "Hide secret" : "Show secret"}
        aria-pressed={visible}
        className="absolute right-1 top-1"
        isDisabled={disabled || revealing || (!configured && !value)}
        isIconOnly
        variant="ghost"
        onPress={() => void toggleVisibility()}
      >
        <HugeiconsIcon
          aria-hidden="true"
          icon={visible ? ViewOffSlashIcon : ViewIcon}
          className="size-4"
        />
      </Button>
    </div>
  );
}
