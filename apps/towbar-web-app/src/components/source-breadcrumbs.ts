"use client";

import type { Source } from "@workspace/towbar-web-client";
import type { BreadcrumbAncestors } from "@workspace/web-page-sections/page";

import { sourcesBreadcrumb } from "@/components/page-parts";
import { useApiQuery } from "@/hooks/use-api-query";

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
        href: `/sources/${sourceId}`,
        label: source.data?.source.repositoryName ?? "Source",
      }
    : undefined;

  return [
    ...sourcesBreadcrumb,
    ...(sourceAncestor ? [sourceAncestor] : []),
    ...(section ? [section] : []),
  ] as BreadcrumbAncestors;
}
