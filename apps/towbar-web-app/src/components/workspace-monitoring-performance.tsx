"use client";
import { useEffect, useState } from "react";
import { Analytics01Icon } from "@hugeicons/core-free-icons";
import { Input } from "@workspace/web-design-system/forms/input";
import { Button } from "@workspace/web-design-system/buttons/button";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { DashboardPage } from "./page-parts";
import { ScoutSelect } from "./scout-controls";
import { MonitoringHistory } from "./monitoring-history";
import { useApiQuery } from "@/hooks/use-api-query";
import type { MonitoringEntity } from "./workspace-monitoring-shared";

export function WorkspacePerformance() {
  const [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [kind, setKind] = useState("all");
  const [cursors, setCursors] = useState<string[]>([""]);
  const [selected, setSelected] = useState<MonitoringEntity | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setCursors([""]);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useApiQuery<{
    entities: MonitoringEntity[];
    nextAfter: string | null;
  }>(
    `/v1/core/monitoring/entities?kind=${kind}&search=${encodeURIComponent(debounced)}&after=${encodeURIComponent(cursors.at(-1)!)}`,
    30_000,
  );
  useEffect(() => {
    if (!selected && query.data?.entities[0])
      setSelected(query.data.entities[0]);
  }, [query.data, selected]);
  const options =
    query.data?.entities.map((entity) => ({
      id: entity.key,
      label: `${entity.name} · ${entity.kind === "server" ? "Server" : `${entity.kind === "app" ? "App" : "Resource"} · ${entity.serverName}`}`,
    })) ?? [];
  if (selected && !options.some((option) => option.id === selected.key))
    options.unshift({
      id: selected.key,
      label: `${selected.name} · ${selected.kind}`,
    });
  return (
    <DashboardPage title="Performance" icon={Analytics01Icon}>
      <div className="grid min-w-0 gap-6">
        <div className="grid items-end gap-4 md:grid-cols-[10rem_1fr_2fr]">
          <ScoutSelect
            label="Type"
            value={kind}
            options={[
              { id: "all", label: "All types" },
              { id: "server", label: "Servers" },
              { id: "app", label: "Apps" },
              { id: "resource", label: "Resources" },
            ]}
            onChange={(value) => {
              setKind(value);
              setCursors([""]);
            }}
          />
          <label className="grid gap-2 text-sm">
            Find an entity
            <Input
              aria-label="Find an entity"
              placeholder="Name or server IP"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              variant="secondary"
            />
          </label>
          <ScoutSelect
            label="Server, app, or resource"
            value={selected?.key ?? ""}
            options={options}
            onChange={(key) => {
              const entity = query.data?.entities.find(
                (item) => item.key === key,
              );
              if (entity) setSelected(entity);
            }}
          />
        </div>
        {query.error ? <QueryError message={query.error} /> : null}
        {query.data && !query.data.entities.length ? (
          <p className="text-sm text-muted">No matching entities.</p>
        ) : null}
        {cursors.length > 1 || query.data?.nextAfter ? (
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="secondary"
              isDisabled={cursors.length === 1}
              onPress={() => setCursors((old) => old.slice(0, -1))}
            >
              Previous entities
            </Button>
            <Button
              size="sm"
              variant="secondary"
              isDisabled={!query.data?.nextAfter}
              onPress={() =>
                setCursors((old) => [...old, query.data!.nextAfter!])
              }
            >
              More entities
            </Button>
          </div>
        ) : null}
        {selected ? (
          <MonitoringHistory
            key={selected.key}
            path={`/v1/core/${selected.kind === "server" ? "servers" : selected.kind === "app" ? "apps" : "resources"}/${selected.id}/metrics`}
            serverId={selected.serverId}
            workload={selected.kind !== "server"}
          />
        ) : query.data ? (
          <div className="rounded-2xl bg-default p-8 text-center text-muted">
            Add a server or connect a source to start viewing performance.
          </div>
        ) : !query.error ? (
          <QueryLoading />
        ) : null}
      </div>
    </DashboardPage>
  );
}
