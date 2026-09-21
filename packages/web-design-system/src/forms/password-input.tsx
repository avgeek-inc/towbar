"use client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ViewIcon, ViewOffSlashIcon } from "@hugeicons/core-free-icons";
import { useState, type ComponentProps } from "react";
import { Input } from "./input";
import { cn } from "../lib/utils";

export type PasswordInputProps = Omit<ComponentProps<typeof Input>, "type">;
export function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative w-full">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        className={cn("w-full pr-11 md:pr-9", className)}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        disabled={props.disabled}
        className="absolute inset-y-0 right-1 my-auto grid size-9 place-items-center rounded-full text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 md:size-7"
        onClick={() => setVisible((value) => !value)}
      >
        <HugeiconsIcon
          aria-hidden="true"
          icon={visible ? ViewOffSlashIcon : ViewIcon}
          className="size-5 md:size-4"
        />
      </button>
    </div>
  );
}
