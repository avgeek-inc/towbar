"use client";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { useEffect, useState } from "react";
import {
  Autocomplete,
  SearchField,
} from "@workspace/web-design-system/pickers/autocomplete";
import { ListBox } from "@workspace/web-design-system/forms/select";
import { Label } from "@workspace/web-design-system/forms/label";
import { Chip } from "@workspace/web-design-system/data-display/chip";
import { Button } from "@workspace/web-design-system/buttons/button";
import { QueryError } from "@workspace/towbar-web-ui/query-state";
import { useApiQuery } from "@/hooks/use-api-query";
import { ScoutIcon } from "./scout-icons";
import { ScoutSelect } from "./scout-controls";
import type { MonitoringEntity } from "./workspace-monitoring-shared";

export function MonitoringEntityPicker({
  kind,
  onKindChange,
  selected,
  onSelect,
  allowAll = false,
}: {
  kind: string;
  onKindChange: (kind: string) => void;
  selected: MonitoringEntity | null;
  onSelect: (entity: MonitoringEntity | null) => void;
  allowAll?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [after, setAfter] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setAfter("");
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useApiQuery<{
    entities: MonitoringEntity[];
    nextAfter: string | null;
  }>(
    `/v1/core/monitoring/entities?kind=${kind}&search=${encodeURIComponent(debounced)}&after=${encodeURIComponent(after)}&limit=100`,
    30_000,
  );
  useEffect(() => {
    if (
      !allowAll &&
      (!selected || (kind !== "all" && selected.kind !== kind)) &&
      query.data?.entities[0]
    )
      onSelect(query.data.entities[0]);
  }, [allowAll, kind, selected, query.data, onSelect]);
  const entities = [...(query.data?.entities ?? [])];
  if (
    selected &&
    !debounced &&
    (kind === "all" || selected.kind === kind) &&
    !entities.some((e) => e.key === selected.key)
  )
    entities.unshift(selected);
  return (
    <div className="grid min-w-0 items-start gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
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
          setSearch("");
          setDebounced("");
          setAfter("");
          onKindChange(value);
          if (selected && value !== "all" && selected.kind !== value)
            onSelect(null);
        }}
      />
      <div className="grid min-w-0 gap-2">
        <Autocomplete
          aria-label="Server, app, or resource"
          selectedKey={selected?.key ?? (allowAll ? "all" : null)}
          variant="secondary"
          fullWidth
          isOpen={open}
          onOpenChange={(value) => {
            setOpen(value);
            if (!value) {
              setSearch("");
              setDebounced("");
              setAfter("");
            }
          }}
          onSelectionChange={(key) => {
            if (key === "all") onSelect(null);
            else {
              const entity = entities.find((e) => e.key === key);
              if (entity) onSelect(entity);
            }
          }}
        >
          <Label>Server, app, or resource</Label>
          <Autocomplete.Trigger>
            <Autocomplete.Value className="flex min-w-0 items-center">
              {() =>
                selected ? (
                  <EntityOption entity={selected} />
                ) : (
                  <span>{allowAll ? "All entities" : "Select an entity"}</span>
                )
              }
            </Autocomplete.Value>
            <Autocomplete.Indicator />
          </Autocomplete.Trigger>
          <Autocomplete.Popover className="max-w-[calc(100vw-2rem)]">
            <Autocomplete.Filter inputValue={search} onInputChange={setSearch}>
              <SearchField
                aria-label="Search entities"
                variant="secondary"
                className="px-2 pt-2"
              >
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input placeholder="Search by name or IP…" />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <ListBox
                aria-label="Entities"
                className="max-h-80 overflow-y-auto"
                renderEmptyState={() => (
                  <p className="p-4 text-sm text-muted">
                    {query.data ? "No matching entities." : "Loading entities…"}
                  </p>
                )}
              >
                {allowAll ? (
                  <ListBox.Item id="all" textValue="All entities">
                    <span className="flex items-center gap-2">
                      <ScoutIcon name="all" />
                      All entities
                    </span>
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ) : null}
                {entities.map((entity) => (
                  <ListBox.Item
                    id={entity.key}
                    key={entity.key}
                    textValue={`${entity.name} ${entity.kind} ${entity.serverName}`}
                  >
                    <EntityOption entity={entity} />
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                ))}
              </ListBox>
            </Autocomplete.Filter>
            {query.data?.nextAfter || after ? (
              <div className="flex justify-end gap-2 p-2">
                {after ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => setAfter("")}
                  >
                    <HugeiconsIcon
                      aria-hidden="true"
                      icon={ArrowLeft01Icon}
                      className="size-4 shrink-0"
                    />
                    First results
                  </Button>
                ) : null}
                {query.data?.nextAfter ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => setAfter(query.data!.nextAfter!)}
                  >
                    More results
                    <ScoutIcon name="next" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Autocomplete.Popover>
        </Autocomplete>
        {query.error ? <QueryError message={query.error} /> : null}
        {!allowAll && query.data && !query.data.entities.length && !selected ? (
          <p className="text-sm text-muted">No matching entities.</p>
        ) : null}
      </div>
    </div>
  );
}
function EntityOption({ entity }: { entity: MonitoringEntity }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-2 py-0.5">
      <ScoutIcon name={entity.kind} />
      <span className="truncate">{entity.name}</span>
      <Chip
        size="small"
        variant={
          entity.kind === "server"
            ? "info"
            : entity.kind === "app"
              ? "success"
              : "warning"
        }
      >
        {entity.kind === "server"
          ? "Server"
          : entity.kind === "app"
            ? "App"
            : "Resource"}
      </Chip>
      {entity.kind !== "server" ? (
        <Chip size="small" variant="secondary">
          {entity.serverName}
        </Chip>
      ) : null}
    </span>
  );
}
