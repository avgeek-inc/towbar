"use client";

import { Switch as HeroSwitch } from "@heroui/react";
import type { ComponentProps } from "react";

export type SwitchProps = Omit<ComponentProps<typeof HeroSwitch>, "size">;

function SwitchRoot(props: SwitchProps) {
  return <HeroSwitch {...props} size="sm" />;
}

SwitchRoot.displayName = "Switch";

export const Switch = Object.assign(SwitchRoot, {
  Root: SwitchRoot,
  Content: HeroSwitch.Content,
  Control: HeroSwitch.Control,
  Thumb: HeroSwitch.Thumb,
  Icon: HeroSwitch.Icon,
});
