"use client";

import { createElement } from "react";

import type { Source } from "@workspace/towbar-web-client";
import type { BreadcrumbAncestors } from "@workspace/web-page-sections/page";

import { sourcesBreadcrumb } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";
import { BreadcrumbEntitySwitcher } from "./breadcrumb-entity-switcher";

export function useSourceBreadcrumbs(
  sourceId: string | undefined,
  section?: { href: string; label: string },
) {
  const source = useApiQuery<{
    canManageSource: boolean;
    source: Source;
  }>(sourceId ? `/v1/core/sources/${sourceId}` : null);
  const sourceAncestor = sourceId
    ? {
        href: `/repositories/${sourceId}/environments`,
        label: source.data?.source.repositoryName ?? "Repository",
        contentKey: `sources:${sourceId}:${source.data?.source.repositoryName ?? "Repository"}`,
        content: createElement(BreadcrumbEntitySwitcher, {
          currentId: sourceId,
          kind: "sources",
          label: source.data?.source.repositoryName ?? "Repository",
        }),
      }
    : undefined;

  return [
    ...sourcesBreadcrumb,
    ...(sourceAncestor ? [sourceAncestor] : []),
    ...(section ? [section] : []),
  ] as BreadcrumbAncestors;
}
