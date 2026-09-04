import {
  ComputerIcon,
  DashboardCircleIcon,
  DashboardSquare01Icon,
  DatabaseIcon,
  GitBranchIcon,
  HealthIcon,
  Key01Icon,
  Logout03Icon,
  PlugSocketIcon,
  ServerStack01Icon,
  UserAccountIcon,
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
  apps: DashboardCircleIcon,
  health: HealthIcon,
  integrations: PlugSocketIcon,
  logout: Logout03Icon,
  overview: DashboardSquare01Icon,
  profile: UserAccountIcon,
  resources: DatabaseIcon,
  secrets: Key01Icon,
  servers: ServerStack01Icon,
  sessions: ComputerIcon,
  sources: GitBranchIcon,
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
      id: "overview",
      items: [
        {
          kind: "link",
          id: "overview",
          label: "Overview",
          href: "/",
          icon: sidebarIcons.overview,
        },
      ],
    },
    {
      id: "operate",
      label: "Operate",
      items: [
        {
          kind: "link",
          id: "sources",
          label: "Sources",
          href: "/sources",
          icon: sidebarIcons.sources,
        },
        {
          kind: "link",
          id: "apps",
          label: "Apps",
          href: "/apps",
          icon: sidebarIcons.apps,
        },
        {
          kind: "link",
          id: "resources",
          label: "Resources",
          href: "/resources",
          icon: sidebarIcons.resources,
        },
        {
          kind: "link",
          id: "servers",
          label: "Servers",
          href: "/servers",
          icon: sidebarIcons.servers,
        },
      ],
    },
    {
      id: "account",
      label: "Account",
      items: [
        {
          kind: "link",
          id: "profile",
          label: "Profile",
          href: "/account/profile",
          icon: sidebarIcons.profile,
        },
        {
          kind: "link",
          id: "sessions",
          label: "Sessions",
          href: "/account/sessions",
          icon: sidebarIcons.sessions,
        },
      ],
    },
    {
      id: "manage",
      label: "Manage",
      items: [
        {
          kind: "link",
          id: "integrations",
          label: "Integrations",
          href: "/manage/integrations",
          icon: sidebarIcons.integrations,
        },
        {
          kind: "link",
          id: "shared-secrets",
          label: "Shared secrets",
          href: "/manage/shared-secrets",
          icon: sidebarIcons.secrets,
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
