"use client";

import {
  Pagination as HeroPagination,
  paginationVariants,
  type PaginationRootProps,
} from "@heroui/react";
import type { ReactNode } from "react";

type NativePaginationProps = PaginationRootProps & {
  hasNextPage?: never;
  onPageChange?: never;
  page?: never;
  totalPages?: never;
};

type ManagedPaginationProps = Omit<PaginationRootProps, "children"> & {
  children?: never;
  /** Current one-based page. */
  page: number;
  /** Total page count. Use `null` when only previous/next availability is known. */
  totalPages?: number | null;
  /** Enables the next control when `totalPages` is unknown. */
  hasNextPage?: boolean;
  /** Receives the next one-based page selected by the user. */
  onPageChange: (page: number) => void;
};

type PaginationProps = ManagedPaginationProps | NativePaginationProps;

function getBoundedPageNumbers(page: number, totalPages: number) {
  return Array.from(new Set([1, page - 1, page, page + 1, totalPages]))
    .filter((pageNumber) => pageNumber >= 1 && pageNumber <= totalPages)
    .sort((left, right) => left - right);
}

function isManagedPaginationProps(
  props: PaginationProps,
): props is ManagedPaginationProps {
  return props.page !== undefined;
}

function ManagedPagination(paginationProps: PaginationProps) {
  if (!isManagedPaginationProps(paginationProps)) {
    const { children, ...props } = paginationProps;

    return <HeroPagination {...props}>{children}</HeroPagination>;
  }

  const {
    hasNextPage = false,
    onPageChange,
    page,
    totalPages,
    ...props
  } = paginationProps;

  const visiblePages =
    totalPages === null || totalPages === undefined
      ? [page]
      : getBoundedPageNumbers(page, totalPages);
  const canGoPrevious = page > 1;
  const canGoNext =
    totalPages === null || totalPages === undefined
      ? hasNextPage
      : page < totalPages;

  return (
    <HeroPagination {...props}>
      <HeroPagination.Summary>
        {totalPages === null || totalPages === undefined
          ? `Page ${page}`
          : `Page ${page} of ${totalPages}`}
      </HeroPagination.Summary>
      <HeroPagination.Content>
        <HeroPagination.Item>
          <HeroPagination.Previous
            isDisabled={!canGoPrevious}
            onPress={() => onPageChange(page - 1)}
          >
            <HeroPagination.PreviousIcon />
            <span>Previous</span>
          </HeroPagination.Previous>
        </HeroPagination.Item>
        {visiblePages.map((pageNumber, index) => {
          const previousPage = visiblePages[index - 1];
          const needsEllipsis =
            previousPage !== undefined && pageNumber - previousPage > 1;
          const items: ReactNode[] = [];

          if (needsEllipsis) {
            items.push(
              <HeroPagination.Item key={`ellipsis-${pageNumber}`}>
                <HeroPagination.Ellipsis />
              </HeroPagination.Item>,
            );
          }

          items.push(
            <HeroPagination.Item key={pageNumber}>
              <HeroPagination.Link
                aria-label={`Go to page ${pageNumber}`}
                isActive={pageNumber === page}
                onPress={() => onPageChange(pageNumber)}
              >
                {pageNumber}
              </HeroPagination.Link>
            </HeroPagination.Item>,
          );

          return items;
        })}
        <HeroPagination.Item>
          <HeroPagination.Next
            isDisabled={!canGoNext}
            onPress={() => onPageChange(page + 1)}
          >
            <span>Next</span>
            <HeroPagination.NextIcon />
          </HeroPagination.Next>
        </HeroPagination.Item>
      </HeroPagination.Content>
    </HeroPagination>
  );
}

const Pagination = Object.assign(ManagedPagination, HeroPagination);

export { Pagination, paginationVariants };
export type {
  PaginationContentProps,
  PaginationEllipsisProps,
  PaginationItemProps,
  PaginationLinkProps,
  PaginationNextIconProps,
  PaginationNextProps,
  PaginationPreviousIconProps,
  PaginationPreviousProps,
  PaginationRootProps,
  PaginationSummaryProps,
  PaginationVariants,
} from "@heroui/react";
export type { ManagedPaginationProps, NativePaginationProps, PaginationProps };
