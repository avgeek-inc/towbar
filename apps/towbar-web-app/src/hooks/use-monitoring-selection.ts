"use client";
import { useCallback, useState } from "react";
import type { MonitoringEntity } from "@/components/workspace-monitoring-shared";
import { usePageQuery } from "./use-page-query";

export function useMonitoringSelection() {
  const { search, update } = usePageQuery();
  const kind = ["server", "app", "resource"].includes(search.get("kind") ?? "")
    ? search.get("kind")!
    : "all";
  const entityKey = search.get("entity");
  const [resolved, resolve] = useState<MonitoringEntity | null>(null);
  const selected =
    resolved?.key === entityKey && (kind === "all" || resolved.kind === kind)
      ? resolved
      : null;
  const select = useCallback(
    (entity: MonitoringEntity | null, replace = false) => {
      update({ entity: entity?.key ?? null, instance: null }, replace);
      resolve(entity);
    },
    [update],
  );
  const setKind = useCallback(
    (value: string) =>
      update({
        kind: value === "all" ? null : value,
        entity: null,
        instance: null,
        entitySearch: null,
      }),
    [update],
  );
  return { kind, setKind, entityKey, selected, select, resolve };
}
