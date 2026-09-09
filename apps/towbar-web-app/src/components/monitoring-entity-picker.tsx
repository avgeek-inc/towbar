"use client";
import { usePageQuery } from "@/hooks/use-page-query";

import { useEffect, useMemo, useState } from "react";
import { QueryError } from "@workspace/towbar-web-ui/query-state";
import { Input } from "@workspace/web-design-system/forms/input";
import { api } from "@/lib/api";
import { SecondaryItems, SecondarySection } from "./secondary-sidebar";
import { ScoutIcon } from "./scout-icons";
import { ScoutSelect } from "./scout-controls";
import type { MonitoringEntity } from "./workspace-monitoring-shared";

export function MonitoringEntityPicker({
  kind,
  onKindChange,
  selected,
  entityKey,
  onResolve,
  onSelect,
  allowAll = false,
}: {
  kind: string;
  onKindChange: (kind: string) => void;
  selected: MonitoringEntity | null;
  entityKey: string | null;
  onResolve: (entity: MonitoringEntity | null) => void;
  onSelect: (entity: MonitoringEntity | null, replace?: boolean) => void;
  allowAll?: boolean;
}) {
  const { search: pageQuery, update } = usePageQuery();
  const search = pageQuery.get("entitySearch") ?? "";
  const setSearch = (value: string) =>
    update({ entitySearch: value || null }, true);
  const [result, setResult] = useState<{
    kind: string;
    entities: MonitoringEntity[];
  }>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const entities: MonitoringEntity[] = [];
        let after: string | null = "";
        do {
          const page: {
            entities: MonitoringEntity[];
            nextAfter: string | null;
          } = await api.get(
            `/v1/core/monitoring/entities?kind=${kind}&after=${encodeURIComponent(after)}&limit=100`,
          );
          if (!active) return;
          entities.push(...page.entities);
          after = page.nextAfter;
        } while (after);
        setResult({ kind, entities });
        setError(undefined);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error ? cause.message : "Could not load entities",
          );
      }
    }
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [kind]);
  const entities = useMemo(
    () => (result?.kind === kind ? result.entities : []),
    [result, kind],
  );
  useEffect(() => {
    if (result?.kind !== kind) return;
    if (entityKey) {
      onResolve(entities.find((entity) => entity.key === entityKey) ?? null);
    } else if (!allowAll && entities.length) {
      onSelect(entities[0]!, true);
    } else onResolve(null);
  }, [kind, result, entities, entityKey, allowAll, onSelect, onResolve]);
  const filtered = entities.filter((entity) =>
    `${entity.name} ${entity.serverName}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <>
      <SecondarySection title="Entity type">
        <ScoutSelect
          label="Type"
          hideLabel
          value={kind}
          options={[
            { id: "all", label: "All types" },
            { id: "server", label: "Servers" },
            { id: "app", label: "Apps" },
            { id: "resource", label: "Resources" },
          ]}
          onChange={(value) => {
            onKindChange(value);
          }}
        />
        <Input
          aria-label="Search entities"
          placeholder="Search name or IP…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="mt-2 w-full"
        />
        {error ? <QueryError message={error} /> : null}
        {entityKey &&
        result?.kind === kind &&
        !entities.some((entity) => entity.key === entityKey) ? (
          <p role="status" className="px-2 text-sm text-muted">
            This entity is unavailable. Choose another entity.
          </p>
        ) : null}
        {result?.kind !== kind && !error ? (
          <p className="px-2 text-sm text-muted">Loading entities…</p>
        ) : null}
      </SecondarySection>
      <SecondaryItems
        title="Entities"
        selected={selected?.key ?? "all"}
        onSelect={(key) =>
          onSelect(entities.find((entity) => entity.key === key) ?? null)
        }
        items={[
          ...(allowAll
            ? [
                {
                  id: "all",
                  label: "All entities",
                  icon: <ScoutIcon name="all" />,
                },
              ]
            : []),
          ...filtered.map((entity) => ({
            id: entity.key,
            icon: <ScoutIcon name={entity.kind} />,
            label: (
              <span className="grid gap-0.5">
                <span>{entity.name}</span>
                {entity.kind !== "server" ? (
                  <span className="text-xs font-normal">
                    {entity.serverName}
                  </span>
                ) : null}
              </span>
            ),
          })),
          ...(!filtered.length && result?.kind === kind
            ? [{ id: "empty", label: "No matching entities", disabled: true }]
            : []),
        ]}
      />
    </>
  );
}
