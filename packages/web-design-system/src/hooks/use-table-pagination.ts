"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { DEFAULT_BOUNDED_LIST_LIMIT } from "@workspace/web-design-system/lib/bounded-list";

export const DEFAULT_TABLE_PAGE_SIZE = DEFAULT_BOUNDED_LIST_LIMIT;

interface UseTablePaginationOptions {
  pageSize?: number;
  total?: number;
  hasNextPage?: boolean;
  initialPage?: number;
}

interface UseTablePaginationReturn {
  page: number;
  pageSize: number;
  totalPages: number | null;
  offset: number;
  setPage: (page: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  canGoNext: boolean;
  canGoPrev: boolean;
  reset: () => void;
  setTotal: (total: number) => void;
  getParams: () => { page: number; limit: number; offset: number };
}

function normalizeTablePageSize(pageSize = DEFAULT_TABLE_PAGE_SIZE) {
  return Math.min(DEFAULT_TABLE_PAGE_SIZE, Math.max(1, Math.floor(pageSize)));
}

function useTablePagination(
  options: UseTablePaginationOptions = {},
): UseTablePaginationReturn {
  const normalizedPageSize = normalizeTablePageSize(options.pageSize);
  const [page, setPageState] = useState(() =>
    Math.max(1, Math.floor(options.initialPage ?? 1)),
  );
  const [internalTotal, setInternalTotal] = useState(options.total ?? 0);
  const total = options.total ?? internalTotal;
  const [hasNextPageOverride] = useState(options.hasNextPage);

  const totalPages = useMemo(
    () => (total > 0 ? Math.ceil(total / normalizedPageSize) : null),
    [normalizedPageSize, total],
  );

  const offset = useMemo(
    () => (page - 1) * normalizedPageSize,
    [normalizedPageSize, page],
  );

  const canGoPrev = page > 1;
  const canGoNext = useMemo(() => {
    if (hasNextPageOverride !== undefined) return hasNextPageOverride;
    if (totalPages !== null) return page < totalPages;
    return false;
  }, [hasNextPageOverride, totalPages, page]);

  useEffect(() => {
    if (totalPages !== null && page > totalPages) {
      setPageState(totalPages);
    }
  }, [page, totalPages]);

  const setPage = useCallback(
    (newPage: number) => {
      const clamped = Math.max(
        1,
        totalPages ? Math.min(newPage, totalPages) : newPage,
      );
      setPageState(clamped);
    },
    [totalPages],
  );

  const nextPage = useCallback(() => {
    if (canGoNext) setPageState((p) => p + 1);
  }, [canGoNext]);

  const prevPage = useCallback(() => {
    if (canGoPrev) setPageState((p) => p - 1);
  }, [canGoPrev]);

  const reset = useCallback(() => {
    setPageState(1);
  }, []);

  const setTotal = useCallback((newTotal: number) => {
    setInternalTotal(Math.max(0, Math.floor(newTotal)));
  }, []);

  const getParams = useCallback(
    () => ({ page, limit: normalizedPageSize, offset }),
    [normalizedPageSize, offset, page],
  );

  return {
    page,
    pageSize: normalizedPageSize,
    totalPages,
    offset,
    setPage,
    nextPage,
    prevPage,
    canGoNext,
    canGoPrev,
    reset,
    setTotal,
    getParams,
  };
}

export { normalizeTablePageSize, useTablePagination };
export type { UseTablePaginationOptions, UseTablePaginationReturn };
