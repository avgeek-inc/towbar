"use client";

import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { clearDateTimeLabels } from "@/lib/date-time-display";

type ApiQueryCacheEntry = {
  cachedAt?: number;
  data?: unknown;
  promise?: Promise<unknown>;
};

const apiQueryCache = new Map<string, ApiQueryCacheEntry>();
let cacheGeneration = 0;
const freshCacheDurationMs = 10_000;

function getCachedApiQuery<T>(path: string | null) {
  if (!path) return undefined;
  return apiQueryCache.get(path)?.data as T | undefined;
}

async function loadApiQuery<T>(path: string, force = false): Promise<T> {
  const cached = apiQueryCache.get(path);
  if (cached?.promise) return cached.promise as Promise<T>;
  if (!force) {
    if (
      cached?.data !== undefined &&
      cached.cachedAt !== undefined &&
      Date.now() - cached.cachedAt < freshCacheDurationMs
    ) {
      return cached.data as T;
    }
  }

  const generation = cacheGeneration;
  const promise = api.get<T>(path);
  apiQueryCache.set(path, { ...cached, promise });
  try {
    const data = await promise;
    if (generation === cacheGeneration)
      apiQueryCache.set(path, { cachedAt: Date.now(), data });
    return data;
  } catch (error) {
    if (apiQueryCache.get(path)?.promise === promise)
      apiQueryCache.delete(path);
    throw error;
  }
}

export function prefetchApiQueries(paths: string[]) {
  return Promise.all(paths.map((path) => loadApiQuery(path)));
}

export function clearApiQueryCache() {
  clearDateTimeLabels();
  cacheGeneration += 1;
  apiQueryCache.clear();
  window.dispatchEvent(new Event("towbar:clear-private-data"));
}
export function refreshApiQueries() {
  apiQueryCache.clear();
  window.dispatchEvent(new Event("towbar:refresh"));
}

export function useApiQuery<T>(
  path: string | null,
  refreshMs?: number,
  { keepPreviousData = false }: { keepPreviousData?: boolean } = {},
) {
  const [result, setResult] = useState<{ data: T; path: string } | undefined>(
    () => {
      const data = getCachedApiQuery<T>(path);
      return path && data !== undefined ? { data, path } : undefined;
    },
  );
  const [failure, setFailure] = useState<{ message: string; path: string }>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!path) return;
    let active = true;
    let requestActive = false;
    const load = async (force = false) => {
      if (requestActive) return;
      const generation = cacheGeneration;
      requestActive = true;
      if (active) setIsRefreshing(true);
      try {
        const result = await loadApiQuery<T>(path, force);
        if (active && generation === cacheGeneration) {
          setResult({ data: result, path });
          setFailure(undefined);
        }
      } catch (cause) {
        if (active)
          setFailure({
            message: cause instanceof Error ? cause.message : "Request failed",
            path,
          });
      } finally {
        requestActive = false;
        if (active) setIsRefreshing(false);
      }
    };
    const handleRefresh = () => void load(true);
    const handleClear = () => {
      setResult(undefined);
      setFailure(undefined);
      setRevision((value) => value + 1);
    };
    const handleVisibilityChange = () => {
      if (!document.hidden) void load(true);
    };
    void load(revision > 0);
    const timer = refreshMs
      ? setInterval(() => {
          if (!document.hidden) void load(true);
        }, refreshMs)
      : undefined;
    window.addEventListener("towbar:refresh", handleRefresh);
    window.addEventListener("towbar:clear-private-data", handleClear);
    if (refreshMs)
      document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      window.removeEventListener("towbar:refresh", handleRefresh);
      window.removeEventListener("towbar:clear-private-data", handleClear);
      if (refreshMs)
        document.removeEventListener(
          "visibilitychange",
          handleVisibilityChange,
        );
    };
  }, [path, refreshMs, revision]);
  const currentData =
    result?.path === path ? result.data : getCachedApiQuery<T>(path);
  return {
    data: currentData ?? (keepPreviousData ? result?.data : undefined),
    isPreviousData:
      keepPreviousData && currentData === undefined && result !== undefined,
    error: failure?.path === path ? failure.message : undefined,
    isRefreshing,
    refresh,
  };
}
