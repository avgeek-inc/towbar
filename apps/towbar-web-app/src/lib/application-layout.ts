import type { Action } from "@workspace/towbar-access";
import type { TowbarUser } from "@workspace/towbar-web-client";
import {
  ComputerIcon,
  AlertCircleIcon,
  DashboardCircleIcon,
  DashboardSquare01Icon,
  CubeIcon,
  GitBranchIcon,
  HealthIcon,
  Key01Icon,
  PlugSocketIcon,
  Rocket01Icon,
  SecurityCheckIcon,
  ServerStack01Icon,
  UserAccountIcon,
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { createElement } from "react";

import packageManifest from "../../../../package.json";
import { TowbarBrandLogo } from "@workspace/towbar-web-ui/brand";
import { Avatar } from "@workspace/web-design-system/data-display/avatar";
import type {
  ApplicationPolicy,
  HeaderConfig,
  SidebarConfig,
} from "@workspace/web-design-system/layouts/application-shell-types";
import { defineSidebarIcons } from "@workspace/web-design-system/layouts/sidebar-icons";

const sidebarIcons = defineSidebarIcons({
  incidents: AlertCircleIcon,
  apps: DashboardCircleIcon,
  deployments: Rocket01Icon,
  health: HealthIcon,
  overview: DashboardSquare01Icon,
  profile: UserAccountIcon,
  resources: CubeIcon,
  vulnerabilities: SecurityCheckIcon,
  servers: ServerStack01Icon,
  sessions: ComputerIcon,
  sources: GitBranchIcon,
});

export type ApplicationSidebarCounts = Partial<
  Record<"apps" | "resources" | "servers" | "sources", number>
>;

const inventorySingularLabels = {
  apps: "app",
  resources: "resource",
  servers: "server",
  sources: "repository",
} as const;

const inventoryPluralLabels = {
  apps: "apps",
  resources: "resources",
  servers: "servers",
  sources: "repositories",
} as const;

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
  brandVersion: packageManifest.version,
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
        {
          kind: "link",
          id: "deployments",
          label: "Deployments",
          href: "/deployments",
          icon: sidebarIcons.deployments,
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
          label: "Repositories",
          href: "/repositories",
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
      id: "monitoring",
      label: "Monitor",
      items: [
        {
          kind: "link",
          id: "incidents",
          label: "Incidents",
          href: "/monitoring/incidents",
          icon: sidebarIcons.incidents,
        },
        {
          kind: "link",
          id: "vulnerabilities",
          label: "Vulnerabilities",
          href: "/monitoring/vulnerabilities",
          icon: sidebarIcons.vulnerabilities,
        },
      ],
    },
    {
      id: "workspace",
      label: "Manage",
      items: [
        {
          kind: "link",
          id: "settings",
          label: "My Settings",
          href: "/settings",
          icon: Settings01Icon,
        },
        {
          kind: "link",
          id: "team-settings",
          label: "Team Settings",
          href: "/team-settings/general",
          icon: UserAccountIcon,
        },
        {
          kind: "link",
          id: "integrations",
          label: "Integrations",
          href: "/manage/integrations",
          icon: PlugSocketIcon,
        },
        {
          kind: "link",
          id: "shared-secrets",
          label: "Shared Secrets",
          href: "/manage/shared-secrets",
          icon: Key01Icon,
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

export function createApplicationSidebar(
  counts: ApplicationSidebarCounts = {},
  monitoring?: {
    activeIncidents: number;
    criticalVulnerabilities: number;
  },
  user?: TowbarUser,
) {
  return {
    ...sidebar,
    footerContent: user
      ? createElement(
          "div",
          {
            className:
              "sidebar-identity flex min-w-0 items-start gap-2.5 px-4 py-4 text-sm",
          },
          createElement(Avatar, {
            "aria-hidden": true,
            email: user.email,
            name: user.name,
            size: "md",
          }),
          createElement(
            "div",
            { className: "grid min-w-0 flex-1 gap-1" },
            createElement(
              "span",
              { className: "truncate font-medium" },
              user.name,
            ),
            createElement(
              "span",
              { className: "truncate text-xs text-foreground/70" },
              user.teamName,
            ),
          ),
        )
      : undefined,
    groups: sidebar.groups
      .map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          const permissions: Record<string, Action> = {
            health: "system.read",
            integrations: "integration.manage",
            "shared-secrets": "sharedSecret.list",
          };
          if (item.id === "team-settings")
            return (
              !user ||
              ["team.read", "privateKey.manage"].some((permission) =>
                user.capabilities?.includes(permission as Action),
              )
            );
          return (
            !user ||
            !permissions[item.id] ||
            user.capabilities?.includes(permissions[item.id]!)
          );
        }),
      }))
      .filter((group) => group.items.length > 0)
      .map((group) =>
        group.id === "operate"
          ? {
              ...group,
              items: group.items.map((item) => {
                const id = item.id as keyof ApplicationSidebarCounts;
                const value = counts[id];
                const singular = inventorySingularLabels[id];
                const plural = inventoryPluralLabels[id];
                return value === undefined || !singular
                  ? item
                  : {
                      ...item,
                      badge: {
                        label: `${value} ${value === 1 ? singular : plural}`,
                        value,
                      },
                    };
              }),
            }
          : group.id === "monitoring"
            ? {
                ...group,
                items: group.items.map((item) => {
                  const value =
                    item.id === "incidents"
                      ? monitoring?.activeIncidents
                      : item.id === "vulnerabilities"
                        ? monitoring?.criticalVulnerabilities
                        : undefined;
                  return !value
                    ? item
                    : {
                        ...item,
                        badge: {
                          value,
                          tone: "danger" as const,
                          label:
                            item.id === "incidents"
                              ? `${value} active incident${value === 1 ? "" : "s"}`
                              : `${value} critical or high vulnerabilit${value === 1 ? "y" : "ies"}`,
                        },
                      };
                }),
              }
            : group,
      ),
  } satisfies SidebarConfig;
}

export const applicationPolicy = {
  kind: "internal",
  themeControl: "header",
  toasts: true,
} satisfies ApplicationPolicy;
