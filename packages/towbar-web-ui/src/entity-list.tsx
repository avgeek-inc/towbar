import type { ReactNode } from "react";

import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { ListView } from "@workspace/web-design-system/data-display/list-view";

export type EntityListItem = {
  description?: ReactNode;
  details?: ReactNode;
  href: string;
  id: string;
  status?: ReactNode;
  title: string;
};

export function EntityList({
  ariaLabel,
  emptyAction,
  emptyDescription,
  emptyTitle,
  items,
}: {
  ariaLabel: string;
  emptyAction?: ReactNode;
  emptyDescription: string;
  emptyTitle: string;
  items: EntityListItem[];
}) {
  return (
    <ListView
      aria-label={ariaLabel}
      items={items}
      renderEmptyState={() => (
        <EmptyState className="min-h-64 justify-center">
          <EmptyState.Header>
            <EmptyState.Title>{emptyTitle}</EmptyState.Title>
            <EmptyState.Description className="max-w-md text-pretty">
              {emptyDescription}
            </EmptyState.Description>
          </EmptyState.Header>
          {emptyAction ? (
            <EmptyState.Content>{emptyAction}</EmptyState.Content>
          ) : null}
        </EmptyState>
      )}
      selectionMode="none"
      variant="primary"
      virtualized={items.length > 50}
    >
      {(item) => (
        <ListView.Item href={item.href} id={item.id} textValue={item.title}>
          <ListView.ItemContent>
            <div className="grid min-w-0 flex-1 gap-1">
              <ListView.Title>{item.title}</ListView.Title>
              {item.description ? (
                <ListView.Description>{item.description}</ListView.Description>
              ) : null}
              {item.details ? (
                <div className="text-muted typography--body-xs flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
                  {item.details}
                </div>
              ) : null}
            </div>
          </ListView.ItemContent>
          {item.status ? (
            <ListView.ItemAction>{item.status}</ListView.ItemAction>
          ) : null}
        </ListView.Item>
      )}
    </ListView>
  );
}
