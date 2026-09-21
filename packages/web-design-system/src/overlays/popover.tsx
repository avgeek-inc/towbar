"use client";

import { Popover as HeroPopover, type PopoverProps } from "@heroui/react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
} from "react-aria-components";

function PopoverRoot(props: PopoverProps) {
  return <HeroPopover {...props} />;
}

function PopoverTrigger(props: AriaButtonProps) {
  return <AriaButton {...props} />;
}

export const Popover = Object.assign(PopoverRoot, HeroPopover, {
  Root: PopoverRoot,
  Trigger: PopoverTrigger,
});

export type { PopoverProps } from "@heroui/react";
