import type {
  ApplicationPolicy,
  FooterConfig,
  HeaderConfig,
} from "@workspace/web-design-system/layouts/application-shell-types";

const brand = {
  accessibleLabel: "Towbar home",
  id: "company",
  logoSrc: "/towbar-mark.svg",
  title: "Towbar",
} as const;

export const applicationHeader = {
  alignment: "center",
  brand,
  homeHref: "/",
} satisfies HeaderConfig;

export const applicationFooter = {
  brand,
  copyright: "© {year} Towbar",
} satisfies FooterConfig;

export const applicationPolicy = {
  kind: "product",
  themeControl: "header",
  toasts: true,
} satisfies ApplicationPolicy;
