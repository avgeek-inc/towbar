import type { IconSvgElement } from "@hugeicons/react";
export type SidebarIcon = IconSvgElement;
export function defineSidebarIcons<
  const T extends Readonly<Record<string, IconSvgElement>>,
>(icons: T) {
  return icons;
}
