import { TooltipText } from "@workspace/web-design-system/overlays/tooltip";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Table } from "@workspace/web-design-system/data-display/table";

export type ResourceTableColumn<T> = {
  cell: (item: T) => ReactNode;
  className?: string;
  header: string;
  headerClassName?: string;
  key: string;
  wrapRowLink?: boolean;
};

type LinkNavigateEvent = Parameters<
  NonNullable<ComponentProps<typeof Link>["onNavigate"]>
>[0];

export function ResourceTable<T>({
  ariaLabel,
  columns,
  emptyAction,
  emptyClassName,
  emptyDescription,
  emptyTitle,
  getRowHref,
  getRowKey,
  items,
  onRowLinkIntent,
  onRowLinkNavigate,
  tableClassName,
}: {
  ariaLabel: string;
  columns: ResourceTableColumn<T>[];
  emptyAction?: ReactNode;
  emptyClassName?: string;
  emptyDescription: string;
  emptyTitle: string;
  getRowHref?: (item: T) => string;
  getRowKey: (item: T) => string;
  items: T[];
  onRowLinkIntent?: (item: T) => void;
  onRowLinkNavigate?: (item: T, event: LinkNavigateEvent) => void;
  tableClassName?: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState className={emptyClassName}>
        <EmptyState.Header>
          <EmptyState.Title>{emptyTitle}</EmptyState.Title>
          <EmptyState.Description>{emptyDescription}</EmptyState.Description>
        </EmptyState.Header>
        {emptyAction ? (
          <EmptyState.Content>{emptyAction}</EmptyState.Content>
        ) : null}
      </EmptyState>
    );
  }

  return (
    <Table>
      <Table.ScrollContainer>
        <Table.Content aria-label={ariaLabel} className={tableClassName}>
          <Table.Header>
            {columns.map((column) => (
              <Table.Column
                className={column.headerClassName}
                isRowHeader={column === columns[0]}
                key={column.key}
              >
                {column.header}
              </Table.Column>
            ))}
          </Table.Header>
          <Table.Body>
            {items.map((item) => {
              const key = getRowKey(item);
              const href = getRowHref?.(item);
              return (
                <Table.Row id={key} key={key}>
                  {columns.map((column, index) => (
                    <Table.Cell className={column.className} key={column.key}>
                      {index === 0 && href && column.wrapRowLink !== false ? (
                        <Link
                          className="focus-visible:ring-focus relative inline-flex min-w-0 items-center rounded-lg outline-none underline-offset-4 before:absolute before:inset-x-0 before:-inset-y-3 before:content-[''] pointer-fine:hover:underline focus-visible:ring-2"
                          href={href}
                          onFocus={() => onRowLinkIntent?.(item)}
                          onMouseEnter={() => onRowLinkIntent?.(item)}
                          onNavigate={(event) =>
                            onRowLinkNavigate?.(item, event)
                          }
                          onPointerDown={() => onRowLinkIntent?.(item)}
                        >
                          {column.cell(item)}
                        </Link>
                      ) : (
                        column.cell(item)
                      )}
                    </Table.Cell>
                  ))}
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

export function ResourceName({
  description,
  name,
}: {
  description?: ReactNode;
  name: ReactNode;
}) {
  return (
    <span className="grid min-w-0 gap-0.5">
      <TooltipText
        className="truncate"
        tooltip={typeof name === "string" ? name : undefined}
      >
        {name}
      </TooltipText>
      {description ? (
        <TooltipText
          className="text-muted typography--body-xs truncate font-normal"
          tooltip={typeof description === "string" ? description : undefined}
        >
          {description}
        </TooltipText>
      ) : null}
    </span>
  );
}
