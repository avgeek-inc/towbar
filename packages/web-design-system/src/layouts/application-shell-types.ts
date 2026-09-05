import type { ReactNode } from "react";

import type { SidebarIcon } from "./sidebar-icons";

export type ApplicationKind = "public" | "product" | "internal";
export type ContentWidth = "small" | "compact" | "relaxed" | "broad" | "full";
export type AppShellBreadcrumbItem = { href?: string; label: string };
export type AppShellBreadcrumbItems = readonly [
  AppShellBreadcrumbItem,
  ...AppShellBreadcrumbItem[],
];
export interface ShellLinkConfig {
  kind: "link";
  id: string;
  label: string;
  href: string;
  accessibleLabel?: string;
  external?: boolean;
}
export interface HeaderBrandConfig {
  accessibleLabel: string;
  id: string;
  logo?: ReactNode;
  logoSrc?: string;
  title: string;
}
export interface HeaderConfig {
  alignment?: "start" | "center";
  brand: HeaderBrandConfig;
  callToAction?: ShellLinkConfig;
  homeHref: string;
  mobileNavigation?: { accessibleLabel: string; side?: "left" | "right" };
  navigation?: readonly ShellLinkConfig[];
}
export interface SidebarLinkConfig extends ShellLinkConfig {
  badge?: { label: string; value: number | string };
  icon?: SidebarIcon;
}
export interface SidebarActionConfig {
  kind: "action";
  id: string;
  label: string;
  accessibleLabel?: string;
  confirmation?: {
    cancelLabel: string;
    confirmLabel: string;
    description: string;
    title: string;
  };
  destructive?: boolean;
  disabled?: boolean;
  icon?: SidebarIcon;
  onSelect: () => void;
}
export type SidebarItemConfig = SidebarLinkConfig | SidebarActionConfig;
export interface SidebarGroupConfig {
  id: string;
  items: readonly SidebarItemConfig[];
  label?: string;
}
export interface SidebarConfig {
  accessibleLabel: string;
  brand: HeaderBrandConfig;
  brandVersion?: string;
  footerActions?: readonly SidebarActionConfig[];
  groups: readonly SidebarGroupConfig[];
  homeHref: string;
  persistenceKey?: string;
}
export interface FooterConfig {
  brand: HeaderBrandConfig;
  copyright?: string;
  description?: string;
  linkGroups?: readonly {
    id: string;
    links: readonly ShellLinkConfig[];
    title: string;
  }[];
}
export interface ApplicationPolicy {
  kind: ApplicationKind;
  themeControl?: "header" | "none";
  toasts?: boolean;
}
