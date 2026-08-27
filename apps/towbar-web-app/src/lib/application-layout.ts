import {
  DashboardSquare01Icon,
  GitBranchIcon,
  HealthIcon,
  Logout03Icon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { createElement } from "react";

import { TowbarBrandLogo } from "@workspace/towbar-web-ui/brand";
import type {
  ApplicationPolicy,
  HeaderConfig,
  SidebarConfig,
} from "@workspace/web-design-system/layouts/application-shell-types";
import { defineSidebarIcons } from "@workspace/web-design-system/layouts/sidebar-icons";

const sidebarIcons = defineSidebarIcons({
  logout: Logout03Icon,
  overview: DashboardSquare01Icon,
  settings: Settings02Icon,
  sources: GitBranchIcon,
  health: HealthIcon,
});

const brand = {
  accessibleLabel: "Towbar home",
  id: "towbar",
  logo: createElement(TowbarBrandLogo),
  title: "Towbar",
} as const;

export const applicationHeader = {
  brand,
  homeHref: "/",
} satisfies HeaderConfig;

const sidebar = {
  accessibleLabel: "Towbar navigation",
  brand,
  homeHref: "/",
  groups: [
    {
      id: "operate",
      label: "Operate",
      items: [
        {
          kind: "link",
          id: "overview",
          label: "Overview",
          href: "/",
          icon: sidebarIcons.overview,
        },
        {
          kind: "link",
          id: "sources",
          label: "Sources",
          href: "/sources",
          icon: sidebarIcons.sources,
        },
        {
          kind: "link",
          id: "health",
          label: "System health",
          href: "/system-health",
          icon: sidebarIcons.health,
        },
      ],
    },
    {
      id: "configure",
      items: [
        {
          kind: "link",
          id: "settings",
          label: "Settings",
          href: "/settings",
          icon: sidebarIcons.settings,
        },
      ],
    },
  ],
  persistenceKey: "towbar-sidebar",
} satisfies SidebarConfig;

export function createApplicationSidebar(onSignOut: () => void) {
  return {
    ...sidebar,
    footerActions: [
      {
        kind: "action",
        id: "sign-out",
        label: "Sign out",
        icon: sidebarIcons.logout,
        confirmation: {
          cancelLabel: "Stay signed in",
          confirmLabel: "Sign out",
          description: "This ends the current Towbar session on this browser.",
          title: "Sign out of Towbar?",
        },
        onSelect: onSignOut,
      },
    ],
  } satisfies SidebarConfig;
}

export const applicationPolicy = {
  kind: "internal",
  themeControl: "header",
  toasts: true,
} satisfies ApplicationPolicy;
